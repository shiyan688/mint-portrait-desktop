'use strict';

// Analysis-only helpers. They never edit source image bytes or invent a result.
const { classes: CLASS_NAMES } = require('./manifest.json');
const CLASSES = Object.freeze([...CLASS_NAMES]);
const MAX_PIXELS = 1048576;

function decodeParsingResult(result) {
  if (!result || result.kind !== 'parsing' || !Number.isSafeInteger(result.width) ||
      !Number.isSafeInteger(result.height) || result.width < 1 || result.height < 1 ||
      result.width * result.height > MAX_PIXELS) throw new TypeError('Invalid SegFace result dimensions');
  if (!Array.isArray(result.classes) || result.classes.length !== CLASSES.length ||
      result.classes.some((value, i) => value !== CLASSES[i])) throw new TypeError('Unexpected SegFace class mapping');
  const raw = result.data;
  const typed = raw instanceof Float32Array && result.encoding === 'unit-float32';
  const wire = raw instanceof Uint8Array && result.encoding === 'unit-float32-le';
  if (result.layout !== 'planar' || result.space !== 'roi-original-pixels' || (!typed && !wire) ||
      (typeof SharedArrayBuffer !== 'undefined' && raw.buffer instanceof SharedArrayBuffer) ||
      raw.byteLength !== result.width * result.height * CLASSES.length * 4) {
    throw new TypeError('Expected explicit planar ROI unit-float32 values or unit-float32-le bytes');
  }
  const pixels = result.width * result.height;
  const view = wire ? new DataView(raw.buffer, raw.byteOffset, raw.byteLength) : null;
  const values = new Float32Array(pixels * CLASSES.length);
  const sums = new Float64Array(pixels);
  for (let i = 0; i < values.length; i++) {
    const value = typed ? raw[i] : view.getFloat32(i * 4, true);
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeError('Invalid class probability');
    values[i] = value;
    sums[i % pixels] += value;
  }
  for (const sum of sums) if (Math.abs(sum - 1) > 1e-4) throw new TypeError('Class probabilities do not sum to one');
  return Object.freeze({ width: result.width, height: result.height, classes: CLASSES, probabilities: values });
}

function makeClassMask(result, classNames = ['skin']) {
  const parsed = decodeParsingResult(result);
  if (!Array.isArray(classNames) || classNames.length === 0 || new Set(classNames).size !== classNames.length) {
    throw new TypeError('Choose distinct explicit class names');
  }
  const ids = classNames.map(name => {
    const id = CLASSES.indexOf(name);
    if (id < 0) throw new TypeError('Unknown SegFace class: ' + name);
    return id;
  });
  const pixels = parsed.width * parsed.height;
  const data = new Float32Array(pixels);
  for (const id of ids) for (let p = 0; p < pixels; p++) data[p] += parsed.probabilities[id * pixels + p];
  // Summation can overshoot by a float32 ulp, not by an unvalidated probability.
  for (let p = 0; p < pixels; p++) data[p] = Math.min(1, data[p]);
  return { space: 'roi-original-pixels', encoding: 'unit-float32', width: parsed.width,
    height: parsed.height, data, analysis: { modelFamily: 'SegFace', classIds: ids,
      classNames: [...classNames], purpose: 'analysis-mask-not-an-edit' } };
}

function colorizeLabels(result, palette) {
  const parsed = decodeParsingResult(result);
  if (!Array.isArray(palette) || palette.length !== CLASSES.length || palette.some(color =>
      !Array.isArray(color) || color.length !== 3 || color.some(v => !Number.isInteger(v) || v < 0 || v > 255))) {
    throw new TypeError('Supply an explicit RGB palette for all 19 classes');
  }
  const pixels = parsed.width * parsed.height;
  const data = new Uint8ClampedArray(pixels * 4);
  for (let p = 0; p < pixels; p++) {
    let best = 0;
    for (let c = 1; c < CLASSES.length; c++) {
      if (parsed.probabilities[c * pixels + p] > parsed.probabilities[best * pixels + p]) best = c;
    }
    data.set([...palette[best], 255], p * 4);
  }
  return { width: parsed.width, height: parsed.height, format: 'rgba8', alphaMode: 'straight',
    colorSpace: 'srgb', data, purpose: 'segmentation-visualization-not-retouched-photo' };
}

// O(width*height) separable square minimum filter. Outside-ROI values are zero,
// so an edit never assumes that a cropped-off boundary is safe skin.
function erodeSquare(source, width, height, radius) {
  const horizontal = new Float32Array(source.length), output = new Float32Array(source.length);
  function line(input, target, offset, stride, length) {
    const deque = new Int32Array(length + 2 * radius + 1);
    let head = 0, tail = 0;
    const value = i => i < 0 || i >= length ? 0 : input[offset + i * stride];
    for (let i = -radius; i < length + radius; i++) {
      while (head < tail && deque[head] < i - 2 * radius) head++;
      const current = value(i);
      while (head < tail && value(deque[tail - 1]) >= current) tail--;
      deque[tail++] = i;
      const center = i - radius;
      if (center >= 0 && center < length) target[offset + center * stride] = value(deque[head]);
    }
  }
  for (let y = 0; y < height; y++) line(source, horizontal, y * width, 1, width);
  for (let x = 0; x < width; x++) line(horizontal, output, x, width, height);
  return output;
}

function makeConservativeSkinMasks(result, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(k => !['guardRadiusPx', 'lowConfidence', 'fullConfidence'].includes(k))) {
    throw new TypeError('Use explicit bounded conservative-mask options');
  }
  const allowed = makeClassMask(result, ['skin', 'nose']);
  const radius = options.guardRadiusPx ?? Math.max(2, Math.min(12, Math.round(Math.min(allowed.width, allowed.height) / 160)));
  const low = options.lowConfidence ?? 0.65, full = options.fullConfidence ?? 0.95;
  if (!Number.isSafeInteger(radius) || radius < 1 || radius > 32 ||
      !Number.isFinite(low) || !Number.isFinite(full) || low < 0 || full > 1 || low >= full) {
    throw new TypeError('Guard radius must be 1..32 original pixels, with 0 <= low < full <= 1');
  }
  const guarded = erodeSquare(allowed.data, allowed.width, allowed.height, radius);
  const skin = new Float32Array(guarded.length), protectedMask = new Float32Array(guarded.length);
  for (let p = 0; p < guarded.length; p++) {
    const t = Math.max(0, Math.min(1, (guarded[p] - low) / (full - low)));
    // Never increase the model's class probability. Confidence/geometry can
    // only remove candidate edit coverage, never invent additional safe skin.
    skin[p] = Math.min(guarded[p], t * t * (3 - 2 * t));
    protectedMask[p] = 1 - skin[p];
  }
  const maskClasses = Object.freeze({ skin: Object.freeze(['skin', 'nose']),
    protected: Object.freeze(CLASSES.filter(c => !['skin', 'nose'].includes(c))) });
  const policy = Object.freeze({ version: 'segface-conservative-v1',
    kind: 'deterministic-mask-postprocessing-not-a-retouch-model',
    maskClasses, classIds: Object.freeze({ skin: Object.freeze([2, 10]),
      protected: Object.freeze(CLASSES.map((_, i) => i).filter(i => i !== 2 && i !== 10)) }),
    guard: Object.freeze({ method: 'separable-square-minimum', radiusPx: radius,
      units: 'original-roi-pixels', outsideRoi: 'fully-protected' }),
    confidence: Object.freeze({ low, full, curve: 'smoothstep-clamped-to-guarded-probability' }),
    protectedIncludes: 'other-model-classes-plus-boundary-margin-and-uncertainty',
    limitation: 'Cannot repair confident misclassification or separately identify beard/moustache.' });
  return { width: allowed.width, height: allowed.height, space: 'roi-original-pixels',
    encoding: 'unit-float32', skin, protected: protectedMask, policy };
}

module.exports = { CLASSES, MAX_PIXELS, decodeParsingResult, makeClassMask, colorizeLabels, makeConservativeSkinMasks };
