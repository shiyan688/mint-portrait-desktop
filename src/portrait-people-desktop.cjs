/* Desktop policy for the frozen MintPortraitPeople / PortraitEngine pair.
 * No models, source mutations, implicit resize or sequential cross-face replay.
 * Active resource figures are allocation/work estimates, not measured process RSS.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./portrait-people.cjs'), require('./portrait-engine.cjs'));
  } else root.MintPortraitPeopleDesktop = factory(root.MintPortraitPeople, root.PortraitEngine);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (People, engine) {
  'use strict';
  if (!People || People.version !== 1 || !engine) throw new Error('Portrait people core and portrait engine must load before the desktop adapter.');
  const LIMITS = Object.freeze({ maxPixels: 16000000, maxEdge: 16384, maxExtraBytes: 268435456, maxWorkUnits: 512000000, maxCumulativeTypedArrayBytes: 536870912, maxNoOpPixels: 64000000 });
  const BEAUTY = ['smooth', 'brighten', 'warmth', 'underEye', 'redness', 'lip', 'blush'];
  const RESHAPE = ['slim', 'eyes', 'nose', 'jaw'];
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const processor = People.createProcessor({ engine, limits: { maxPixels: LIMITS.maxPixels, maxEdge: LIMITS.maxEdge, maxExtraBytes: LIMITS.maxExtraBytes, maxWorkUnits: LIMITS.maxWorkUnits } });
  const typed = Object.getPrototypeOf(Uint8Array.prototype);
  const typedLength = Object.getOwnPropertyDescriptor(typed, 'length').get;
  const typedBuffer = Object.getOwnPropertyDescriptor(typed, 'buffer').get;
  const arrayBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  const resizableDescriptor = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable');
  const arrayBufferResizable = resizableDescriptor && resizableDescriptor.get;
  function fail(code, message, Type) { const error = new (Type || Error)(message); error.code = code; throw error; }
  function record(value, required, allowed, label) {
    if (!value || typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail('INVALID_RECORD', label + ' must be a plain own-data record.', TypeError);
    const ds = Object.getOwnPropertyDescriptors(value), out = Object.create(null);
    for (const key of Reflect.ownKeys(ds)) {
      if (typeof key !== 'string' || (allowed && !allowed.includes(key))) fail('UNKNOWN_FIELD', label + ' has an unknown field or symbol.', TypeError);
      if (!own(ds[key], 'value')) fail('ACCESSOR', label + '.' + key + ' cannot be an accessor.', TypeError);
      if (!ds[key].enumerable) fail('HIDDEN_FIELD', label + '.' + key + ' cannot be hidden.', TypeError);
      out[key] = ds[key].value;
    }
    for (const key of required) if (!own(out, key)) fail('MISSING_FIELD', label + '.' + key + ' is required.', TypeError);
    return out;
  }
  function text(value, label) {
    if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) fail('INVALID_TEXT', label + ' must be a nonempty bounded string.', TypeError);
    return value;
  }
  function phaseValue(phase) { if (phase !== 'beauty' && phase !== 'reshape') fail('PHASE', 'phase must be beauty or reshape.', RangeError); return phase; }
  function sameDetector(a, b) { return a.id === b.id && a.modelSha256 === b.modelSha256 && a.topology === b.topology; }
  function detectorValue(value) {
    const d = record(value, ['id', 'modelSha256', 'topology'], ['id', 'modelSha256', 'topology'], 'detector');
    if (!sameDetector(d, People.DEFAULT_DETECTOR)) fail('MODEL_MISMATCH', 'Desktop portrait faces require the pinned MediaPipe478 detector/model.');
    return { id: d.id, modelSha256: d.modelSha256, topology: d.topology };
  }
  function context(value, planning) {
    const keys = ['sourceRevision', 'batchId', 'detector', 'shouldCancel'].concat(planning ? ['phase'] : []);
    const c = record(value, ['sourceRevision'].concat(planning ? ['phase'] : []), keys, 'context');
    text(c.sourceRevision, 'context.sourceRevision');
    if (own(c, 'batchId')) text(c.batchId, 'context.batchId');
    if (own(c, 'detector')) c.detector = detectorValue(c.detector);
    if (own(c, 'shouldCancel') && typeof c.shouldCancel !== 'function') fail('INVALID_CALLBACK', 'shouldCancel must be a function.', TypeError);
    if (planning) phaseValue(c.phase);
    return c;
  }
  // Called only after core schema validation bounded the tree and rejected every
  // accessor, hole, unknown field, symbol and unexpected object prototype.
  function visibleTree(value) {
    if (!value || typeof value !== 'object') return;
    const ds = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(ds)) {
      if (Array.isArray(value) && key === 'length') continue;
      if (!ds[key].enumerable) fail('HIDDEN_FIELD', 'Portrait metadata fields must be enumerable.', TypeError);
      visibleTree(ds[key].value);
    }
  }
  function readBatch(value, c) {
    if (value === null) return null;
    const b = People.validateBatch(value, c);
    visibleTree(value);
    detectorValue(b.detector);
    return b;
  }
  function cancel(c) { if (c.shouldCancel && c.shouldCancel()) fail('CANCELLED', 'Portrait processing was cancelled.'); }
  function validate(value, options) { const c = context(options, false); cancel(c); const b = readBatch(value, c); cancel(c); return b; }
  function active(b, phase) { return !!b && b.faces.some(f => (phase === 'beauty' ? BEAUTY : RESHAPE).some(k => f[phase][k] !== 0)); }
  function hasEffect(value, phase) { phaseValue(phase); return active(readBatch(value), phase); }
  function manualCount(value) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('INVALID_ARRAY', 'manualLiquify must be an ordinary dense array.', TypeError);
    const n = Object.getOwnPropertyDescriptor(value, 'length').value;
    if (n > 64) fail('LIMIT', 'manualLiquify exceeds 64 commands.', RangeError);
    const ds = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(ds);
    if (keys.length !== n + 1) fail('INVALID_ARRAY', 'manualLiquify must have only dense numeric entries.', TypeError);
    for (let i = 0; i < n; i++) {
      if (!own(ds, String(i)) || !own(ds[i], 'value')) fail('ACCESSOR', 'manualLiquify cannot have holes or accessors.', TypeError);
      if (!ds[i].enumerable) fail('HIDDEN_FIELD', 'manualLiquify commands cannot be hidden.', TypeError);
    }
    return n;
  }
  function validateCompatibility(settings, sourceRevision) {
    // This is a projection of the full desktop settings schema, not a replacement
    // for project/manual validation. Other enumerable own-data settings are allowed.
    const s = record(settings, [], null, 'settings');
    const b = validate(own(s, 'faceAdjustments') ? s.faceAdjustments : null, { sourceRevision });
    if (!b) return null;
    for (const key of BEAUTY.concat(RESHAPE)) if (own(s, key)) {
      if (typeof s[key] !== 'number' || !Number.isFinite(s[key])) fail('RANGE', 'Global ' + key + ' must be a finite number in per-face mode.', TypeError);
      if (s[key] !== 0) fail('PORTRAIT_GLOBAL_CONFLICT', 'Per-face mode requires all global beauty and reshape numeric controls to be zero.');
    }
    // Merely choosing a legacy palette or region does not activate any pixels.
    const count = own(s, 'manualLiquify') ? manualCount(s.manualLiquify) : 0;
    if (active(b, 'reshape') && count) fail('MANUAL_STALE_ANALYSIS', 'Active per-face reshape cannot replay with manual liquify using stale face coordinates.');
    if (active(b, 'reshape') && s.bgMode === 'transparent') fail('TRANSPARENT_RESHAPE', 'Active per-face reshape cannot follow a transparent background operation.');
    return b;
  }
  function size(width, height, maxPixels) {
    for (const v of [width, height]) if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > LIMITS.maxEdge) fail('RANGE', 'Image edges must be positive integers no larger than ' + LIMITS.maxEdge + '.', RangeError);
    if (width * height > maxPixels) fail('LIMIT', 'Image exceeds the ' + maxPixels + ' pixel budget.', RangeError);
    return { width, height };
  }
  function imageValue(value) {
    const im = record(value, ['width', 'height', 'data'], ['width', 'height', 'data'], 'image');
    size(im.width, im.height, LIMITS.maxNoOpPixels);
    const data = im.data;
    if (!ArrayBuffer.isView(data) || (Object.getPrototypeOf(data) !== Uint8Array.prototype && Object.getPrototypeOf(data) !== Uint8ClampedArray.prototype)) fail('IMAGE_DATA', 'Image data must be a native non-shared byte typed array.', TypeError);
    for (const key of ['length', 'buffer', 'byteLength', 'byteOffset']) if (own(data, key)) fail('IMAGE_DATA', 'Typed-array properties cannot be overridden.', TypeError);
    if (Object.getOwnPropertySymbols(data).length) fail('IMAGE_DATA', 'Typed-array symbols cannot be overridden.', TypeError);
    const buffer = typedBuffer.call(data);
    let byteLength, resizable;
    try {
      // Captured intrinsic getters brand-check the real backing object. Never
      // execute an instance accessor or trust a shadowed resizable:false value.
      byteLength = arrayBufferByteLength.call(buffer);
      resizable = arrayBufferResizable ? arrayBufferResizable.call(buffer) : false;
    } catch (_) { fail('IMAGE_DATA', 'Image backing storage must be a native ArrayBuffer.', TypeError); }
    if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || resizable || byteLength === 0 || typedLength.call(data) !== im.width * im.height * 4) fail('IMAGE_DATA', 'Expected exactly width * height * 4 non-shared, non-resizable, non-detached RGBA bytes.', TypeError);
    return im;
  }
  function freeze(value) { if (value && typeof value === 'object') { for (const key of Object.keys(value)) freeze(value[key]); Object.freeze(value); } return value; }
  function phaseContext(c) { const out = { sourceRevision: c.sourceRevision }; for (const key of ['batchId', 'detector', 'shouldCancel']) if (own(c, key)) out[key] = c[key]; return out; }
  function noOpPlan(width, height, b, c, phase) {
    const faces = b ? People.getFaceBounds(b).sort((a, z) => a.id.localeCompare(z.id)).map(bounds => ({ id: bounds.id, active: false, displayBounds: bounds, protectedBounds: { minX: Math.max(0, Math.floor(bounds.x * (width - 1) - 1)), minY: Math.max(0, Math.floor(bounds.y * (height - 1) - 1)), maxX: Math.min(width - 1, Math.ceil((bounds.x + bounds.width) * (width - 1) + 1)), maxY: Math.min(height - 1, Math.ceil((bounds.y + bounds.height) * (height - 1) + 1)) }, controls: b.faces.find(f => f.id === bounds.id)[phase], writeBounds: null, readBounds: null, influenceBounds: null })) : [];
    return freeze({ version: 1, phase, sourceRevision: c.sourceRevision, batchId: b ? b.batchId : null, detector: { ...People.DEFAULT_DETECTOR }, width, height, workSize: null, opaqueAlphaRequired: false, noOp: true, desktopLimits: { ...LIMITS }, faces, resources: { pixels: width * height, workPixels: 0, activeFaces: 0, reusedInputBytes: width * height * 4, retainedOutputBytes: 0, maxConcurrentEngineOutputBytes: 0, engineTemporaryBytes: 0, extraPeakBytes: 0, estimatedPeakExtraBytes: 0, cumulativeTypedArrayBytes: 0, workUnits: 0, estimatedWorkUnits: 0, staticEngineTableBytes: 17412, excludes: 'source, canvas/native/GPU/history copies, metadata/JS objects and VM overhead; no new pixel buffer for an inactive phase' } });
  }
  function preparePlan(width, height, b, c, phase) {
    size(width, height, LIMITS.maxNoOpPixels);
    cancel(c);
    if (!active(b, phase)) { const result = noOpPlan(width, height, b, c, phase); cancel(c); return result; }
    // No image-sized buffer exists here. Both peak and cumulative policies pass
    // before apply invokes any individual legacy engine operation.
    const p = processor.planSize(width, height, b, { ...phaseContext(c), phase });
    if (p.resources.cumulativeTypedArrayBytes > LIMITS.maxCumulativeTypedArrayBytes) fail('CUMULATIVE_MEMORY_BUDGET', 'Portrait batch exceeds the 512 MiB cumulative typed-array allocation budget.', RangeError);
    cancel(c);
    return freeze({ ...p, noOp: false, desktopLimits: { ...LIMITS } });
  }
  function planSize(width, height, value, options) {
    const c = context(options, true); cancel(c);
    return preparePlan(width, height, readBatch(value, phaseContext(c)), c, c.phase);
  }
  function apply(image, value, options, phase) {
    const c = context(options, false); cancel(c);
    const b = readBatch(value, c), im = imageValue(image);
    const plan = preparePlan(im.width, im.height, b, c, phase);
    if (plan.noOp) { cancel(c); return image; }
    const result = processor[phase === 'beauty' ? 'applyBeauty' : 'applyReshape']({ width: im.width, height: im.height, data: im.data }, b, phaseContext(c));
    cancel(c);
    return result;
  }
  function geometryBinding(value) {
    const b = readBatch(value);
    if (!active(b, 'reshape')) return null;
    // Complete canonical data, never a lossy hash. Inactive neighbors matter to
    // protection, and a new detection batch invalidates old geometry bindings.
    return freeze({ version: b.version, sourceRevision: b.sourceRevision, batchId: b.batchId, detector: b.detector, detectionSize: b.detectionSize, faces: b.faces.slice().sort((a, z) => a.id.localeCompare(z.id)).map(f => ({ id: f.id, landmarks: f.landmarks, reshape: f.reshape })) });
  }
  return Object.freeze({ version: 1, LIMITS, DEFAULT_DETECTOR: People.DEFAULT_DETECTOR, validate, hasEffect, validateCompatibility, planSize, applyBeauty: (image, value, options) => apply(image, value, options, 'beauty'), applyReshape: (image, value, options) => apply(image, value, options, 'reshape'), geometryBinding });
});
