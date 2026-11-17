'use strict';
const crypto = require('node:crypto');

// Unwired interface scaffold. No models, inference implementations or fallbacks ship here.
const TASKS = Object.freeze(['retouch', 'matting', 'inpaint', 'restore']);
const DEFAULT_MAX_PIXELS = 16777216;
const DEVICE_KINDS = ['cpu', 'cuda', 'directml', 'metal'];
const MODEL_STATUSES = ['ready', 'missing', 'incompatible', 'disabled'];
let sessionSerial = 0;

class BackendContractError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'BackendContractError';
    this.code = code;
  }
}

function fail(code, message) { throw new BackendContractError(code, message); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_INPUT', `${label} must be an object.`);
  return value;
}
function text(value, label) {
  if (typeof value !== 'string' || value.trim() !== value || !value) fail('INVALID_INPUT', `${label} must be a nonempty, trimmed string.`);
  return value;
}
function unit(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail('INVALID_INPUT', `${label} must be finite and in [0, 1].`);
  return value;
}
function size(width, height, maxPixels, label) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      !Number.isSafeInteger(width * height * 4) || width * height > maxPixels) {
    fail('INVALID_INPUT', `${label} dimensions must be positive safe integers within the pixel budget.`);
  }
}
function unshared(data, label) {
  if (!(data.buffer instanceof ArrayBuffer)) fail('INVALID_INPUT', `${label} must use an ordinary, unshared ArrayBuffer.`);
}
function imageSnapshot(image, maxPixels, label) {
  object(image, label);
  const { width, height, format, alphaMode, colorSpace, data } = image;
  size(width, height, maxPixels, label);
  if (format !== 'rgba8' || alphaMode !== 'straight' || colorSpace !== 'srgb') {
    fail('INVALID_INPUT', `${label} must declare rgba8, straight alpha, and srgb.`);
  }
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || data.length !== width * height * 4) {
    fail('INVALID_INPUT', `${label} must contain exactly width * height * 4 RGBA bytes.`);
  }
  unshared(data, label);
  return Object.freeze({ width, height, format, alphaMode, colorSpace, data: new Uint8ClampedArray(data) });
}
function roiSnapshot(roi, image) {
  object(roi, 'ROI');
  const { x, y, width, height } = roi;
  if (![x, y, width, height].every(Number.isSafeInteger) || x < 0 || y < 0 || width < 1 || height < 1 ||
      width > image.width || height > image.height || x > image.width - width || y > image.height - height) {
    fail('INVALID_INPUT', 'ROI must be an in-bounds integer rectangle in original-image pixels.');
  }
  return Object.freeze({ x, y, width, height });
}
function maskSnapshot(mask, roi, label) {
  object(mask, label);
  if (mask.width !== roi.width || mask.height !== roi.height || mask.space !== 'roi-original-pixels' ||
      mask.encoding !== 'unit-float32' || !(mask.data instanceof Float32Array) || mask.data.length !== roi.width * roi.height) {
    fail('INVALID_INPUT', `${label} must be an explicit Float32 mask at original ROI dimensions.`);
  }
  unshared(mask.data, label);
  const data = new Float32Array(mask.data);
  for (const value of data) unit(value, label);
  return Object.freeze({ width: roi.width, height: roi.height, space: 'roi-original-pixels', encoding: 'unit-float32', data });
}
function descriptorSnapshot(descriptor) {
  object(descriptor, 'Model descriptor');
  const id = text(descriptor.id, 'Model ID'), version = text(descriptor.version, 'Model version');
  if (descriptor.kind !== 'model' && descriptor.kind !== 'test-double') fail('INVALID_INPUT', 'Model kind must be explicit.');
  const weightsSha256 = text(descriptor.weightsSha256, 'Weights SHA-256');
  if (!/^[a-f0-9]{64}$/.test(weightsSha256) && !(descriptor.kind === 'test-double' && weightsSha256 === 'test-double:no-weights')) {
    fail('INVALID_INPUT', 'Models require a lowercase 64-hex weights SHA-256; only test doubles may use test-double:no-weights.');
  }
  if (!MODEL_STATUSES.includes(descriptor.status)) fail('INVALID_INPUT', 'Model status is invalid.');
  if (!Array.isArray(descriptor.tasks) || !descriptor.tasks.length ||
      descriptor.tasks.some(task => !TASKS.includes(task)) || new Set(descriptor.tasks).size !== descriptor.tasks.length) {
    fail('INVALID_INPUT', 'Model tasks must be a nonempty, unique list of supported tasks.');
  }
  object(descriptor.device, 'Device');
  if (!DEVICE_KINDS.includes(descriptor.device.kind)) fail('INVALID_INPUT', 'Device kind is invalid.');
  const device = Object.freeze({ kind: descriptor.device.kind, name: text(descriptor.device.name, 'Device name') });
  object(descriptor.license, 'License');
  if (!['approved', 'pending', 'blocked'].includes(descriptor.license.status)) fail('INVALID_INPUT', 'License status is invalid.');
  const licenseId = text(descriptor.license.id, 'License ID'), licenseUrl = text(descriptor.license.url, 'License URL');
  let url;
  try { url = new URL(licenseUrl); } catch { fail('INVALID_INPUT', 'License URL must be an absolute HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password) fail('INVALID_INPUT', 'License URL must be HTTPS without credentials.');
  const license = Object.freeze({ id: licenseId, url: licenseUrl, status: descriptor.license.status });
  return Object.freeze({ id, version, weightsSha256, kind: descriptor.kind, status: descriptor.status, tasks: Object.freeze([...descriptor.tasks]), device, license });
}
function crop(original, roi) {
  const data = new Uint8ClampedArray(roi.width * roi.height * 4);
  for (let y = 0; y < roi.height; y++) {
    const start = ((roi.y + y) * original.width + roi.x) * 4;
    data.set(original.data.subarray(start, start + roi.width * 4), y * roi.width * 4);
  }
  return Object.freeze({ width: roi.width, height: roi.height, format: 'rgba8', alphaMode: 'straight', colorSpace: 'srgb', data });
}
function provenanceSnapshot(value, descriptor, jobId, task) {
  if (!value || value.jobId !== jobId || value.task !== task || value.modelId !== descriptor.id ||
      value.modelVersion !== descriptor.version || value.weightsSha256 !== descriptor.weightsSha256 || value.kind !== descriptor.kind ||
      value.device?.kind !== descriptor.device.kind || value.device?.name !== descriptor.device.name) {
    fail('INVALID_PROVENANCE', 'Result provenance does not match the selected job, task, model, version, weights, kind and device.');
  }
  return Object.freeze({ jobId, task, modelId: descriptor.id, modelVersion: descriptor.version, weightsSha256: descriptor.weightsSha256, kind: descriptor.kind, device: descriptor.device });
}
function refinementSnapshot(value) {
  const required = { kind: 'classical-color-estimation', implementation: 'pymatting', version: '1.1.16', method: 'estimate_foreground_ml' };
  if (!value || Object.entries(required).some(([key, expected]) => value[key] !== expected)) {
    fail('INVALID_OUTPUT', 'Foreground requires explicit supported classical color-estimation provenance.');
  }
  let encoded;
  try { encoded = JSON.stringify(value); } catch { fail('INVALID_OUTPUT', 'Foreground refinement metadata must be bounded JSON.'); }
  if (!encoded || encoded.length > 4096) fail('INVALID_OUTPUT', 'Foreground refinement metadata must be bounded JSON.');
  const copy = JSON.parse(encoded);
  function freeze(node) {
    if (node && typeof node === 'object') { for (const child of Object.values(node)) freeze(child); Object.freeze(node); }
    return node;
  }
  return freeze(copy);
}
function linear(byte) { const v = byte / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
function srgb(value) { return Math.round(255 * Math.max(0, Math.min(1, value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055))); }
function alphaDigest(data) {
  const hash = crypto.createHash('sha256'), block = Buffer.allocUnsafe(16384);
  for (let start = 0; start < data.length; start += 4096) {
    const count = Math.min(4096, data.length - start);
    for (let i = 0; i < count; i++) block.writeFloatLE(data[start + i], i * 4);
    hash.update(block.subarray(0, count * 4));
  }
  return hash.digest('hex');
}

function createBackendSession(originalImage, options = {}) {
  object(options, 'Options');
  const maxPixels = options.maxPixels === undefined ? DEFAULT_MAX_PIXELS : options.maxPixels;
  if (!Number.isSafeInteger(maxPixels) || maxPixels < 1 || maxPixels > Math.floor(Number.MAX_SAFE_INTEGER / 4)) {
    fail('INVALID_INPUT', 'maxPixels must be a positive safe pixel budget.');
  }
  if (options.allowTestDoubles !== undefined && typeof options.allowTestDoubles !== 'boolean') fail('INVALID_INPUT', 'allowTestDoubles must be boolean.');
  const allowTestDoubles = options.allowTestDoubles === true;
  const sessionId = ++sessionSerial;
  let original = imageSnapshot(originalImage, maxPixels, 'Original image');
  const adapters = options.adapters === undefined ? [] : options.adapters;
  if (!Array.isArray(adapters)) fail('INVALID_INPUT', 'Adapters must be an array.');
  const registry = new Map();
  for (const adapter of adapters) {
    object(adapter, 'Adapter');
    const descriptor = descriptorSnapshot(adapter.descriptor);
    if (typeof adapter.run !== 'function') fail('INVALID_INPUT', 'Adapter must expose run().');
    const key = JSON.stringify([descriptor.id, descriptor.version]);
    if (registry.has(key)) fail('INVALID_INPUT', 'Duplicate model ID/version.');
    registry.set(key, { descriptor, run: adapter.run.bind(adapter) });
  }
  let active = null, serial = 0, disposed = false;
  function requireOpen() { if (disposed) fail('SESSION_CLOSED', 'This backend session is disposed.'); }

  function start(request) {
    requireOpen();
    object(request, 'Request');
    const { task, modelId, modelVersion, signal } = request;
    if (!TASKS.includes(task)) fail('UNSUPPORTED_TASK', 'Task is not supported by this contract.');
    text(modelId, 'Requested model ID'); text(modelVersion, 'Requested model version');
    const selected = registry.get(JSON.stringify([modelId, modelVersion]));
    if (!selected) fail('MODEL_MISSING', 'The exact requested model/version is not registered.');
    const { descriptor } = selected;
    if (descriptor.status !== 'ready') fail('MODEL_UNAVAILABLE', `Selected model status is ${descriptor.status}.`);
    if (!descriptor.tasks.includes(task)) fail('INCOMPATIBLE_TASK', 'Selected model does not support this task.');
    if (descriptor.license.status !== 'approved') fail('LICENSE_NOT_APPROVED', 'Selected model license is not approved.');
    if (descriptor.kind === 'test-double' && !allowTestDoubles) fail('TEST_DOUBLE_DISABLED', 'Test doubles require an explicit test-only opt-in.');
    const roi = roiSnapshot(request.roi, original);
    const mask = maskSnapshot(request.mask, roi, 'Edit mask');
    const strength = unit(request.strength, 'Strength');
    if (request.applyForeground !== undefined && (typeof request.applyForeground !== 'boolean' || task !== 'matting')) {
      fail('INVALID_INPUT', 'applyForeground is an explicit boolean option for matting only.');
    }
    const applyForeground = request.applyForeground === true;
    if (request.foregroundStrength !== undefined && !applyForeground) fail('INVALID_INPUT', 'foregroundStrength requires applyForeground: true.');
    const foregroundStrength = request.foregroundStrength === undefined ? 0 : unit(request.foregroundStrength, 'Foreground strength');
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail('INVALID_INPUT', 'signal must be an AbortSignal.');
    // Validate before superseding any useful job. An already-aborted new request does not supersede it.
    const id = `session-${sessionId}-job-${++serial}`;
    const controller = new AbortController();
    let state = 'queued', settled = false, resolve, reject, onAbort;
    const result = new Promise((yes, no) => { resolve = yes; reject = no; });
    function settle(nextState, value, error) {
      if (settled) return false;
      settled = true; state = nextState;
      if (onAbort) signal.removeEventListener('abort', onAbort);
      if (active?.id === id) active = null;
      if (error) reject(error); else resolve(value);
      return true;
    }
    function cancel(nextState = 'cancelled') {
      const code = nextState === 'superseded' ? 'STALE_JOB' : 'CANCELLED';
      const changed = settle(nextState, undefined, new BackendContractError(code, nextState === 'superseded' ? 'A newer job replaced this job.' : 'Job was cancelled.'));
      if (changed) controller.abort();
      return changed;
    }
    const job = Object.freeze({ id, get state() { return state; }, result, cancel: () => cancel() });
    if (signal?.aborted) { cancel(); return job; }
    if (signal) {
      onAbort = () => cancel();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const previous = active;
    active = { id, cancel, supersede: () => cancel('superseded') };
    // Publish the new owner before aborting the old adapter: abort handlers can reenter start().
    if (previous) previous.supersede();
    // The runner never publishes adapter-owned buffers or uses its mutated input for blending.
    queueMicrotask(async () => {
      if (settled) return;
      try {
        if (strength === 0 || !mask.data.some(value => value > 0)) {
          settle('succeeded', Object.freeze({ jobId: id, task, status: 'noop', provenance: null, image: imageSnapshot(original, maxPixels, 'Original image') }));
          return;
        }
        state = 'running';
        const response = await selected.run(Object.freeze({
          jobId: id, task, model: descriptor, originalSize: Object.freeze({ width: original.width, height: original.height }),
          roi, source: crop(original, roi), mask: maskSnapshot(mask, roi, 'Adapter mask'), signal: controller.signal
        }));
        if (settled || active?.id !== id) return; // Even an adapter ignoring abort cannot publish late work.
        let provenance = provenanceSnapshot(response?.provenance, descriptor, id, task);
        let patch, foreground;
        try {
          if (task === 'matting') {
            if (response.image !== undefined) fail('INVALID_OUTPUT', 'Matting returns a matte, not an image.');
            patch = maskSnapshot(response.matte, roi, 'Matte output');
            if (response.foreground !== undefined) {
              foreground = imageSnapshot(response.foreground, maxPixels, 'Foreground output');
              if (foreground.width !== roi.width || foreground.height !== roi.height) fail('INVALID_OUTPUT', 'Foreground must match original ROI dimensions.');
              const foregroundRefinement = refinementSnapshot(response.provenance.foregroundRefinement);
              if (foregroundRefinement.alphaDigest !== alphaDigest(patch.data)) fail('INVALID_OUTPUT', 'Foreground refinement belongs to a different alpha plane; edited alpha requires fresh color estimation.');
              if (foregroundRefinement.sourceDigest !== crypto.createHash('sha256').update(crop(original, roi).data).digest('hex')) fail('INVALID_OUTPUT', 'Foreground refinement belongs to a different original ROI source.');
              provenance = Object.freeze({ ...provenance, foregroundRefinement, foregroundApplied: applyForeground && foregroundStrength > 0, foregroundStrength });
              for (let y = 0; y < roi.height; y++) for (let x = 0; x < roi.width; x++) {
                const p = y * roi.width + x, src = ((roi.y + y) * original.width + roi.x + x) * 4;
                if (foreground.data[p * 4 + 3] !== original.data[src + 3]) fail('INVALID_OUTPUT', 'Foreground must preserve source alpha byte-exactly.');
                if (original.data[src + 3] < 255 || patch.data[p] === 1) {
                  for (let c = 0; c < 3; c++) if (foreground.data[p * 4 + c] !== original.data[src + c]) {
                    fail('INVALID_OUTPUT', 'Foreground must preserve originally translucent/hidden RGB and fully opaque matte interiors.');
                  }
                }
              }
            } else if (applyForeground || response.provenance.foregroundRefinement !== undefined) {
              fail('INVALID_OUTPUT', 'Requested or declared foreground refinement requires a separate foreground plane.');
            }
          } else {
            if (response.foreground !== undefined || response.provenance.foregroundRefinement !== undefined) fail('INVALID_OUTPUT', 'Color tasks cannot disguise foreground color estimation.');
            if (response.matte !== undefined) fail('INVALID_OUTPUT', 'Color tasks return an image, not a matte.');
            patch = imageSnapshot(response.image, maxPixels, 'Image output');
            if (patch.width !== roi.width || patch.height !== roi.height) fail('INVALID_OUTPUT', 'Output must match original ROI dimensions; implicit rescaling is forbidden.');
          }
        } catch (error) {
          if (error instanceof BackendContractError) throw new BackendContractError('INVALID_OUTPUT', error.message, { cause: error });
          throw error;
        }
        const output = imageSnapshot(original, maxPixels, 'Original image');
        for (let y = 0; y < roi.height; y++) {
          for (let x = 0; x < roi.width; x++) {
            const p = y * roi.width + x, src = ((roi.y + y) * original.width + roi.x + x) * 4;
            const weight = mask.data[p] * strength;
            if (task !== 'matting' && patch.data[p * 4 + 3] !== original.data[src + 3]) {
              fail('INVALID_OUTPUT', 'Color-task output must preserve original alpha exactly.');
            }
            if (weight === 0) continue;
            if (task === 'matting') {
              const alphaFactor = 1 - weight + weight * patch.data[p];
              output.data[src + 3] = Math.round(original.data[src + 3] * alphaFactor);
              // Blend two premultiplied linear-light layers, then return straight sRGB.
              // The common source alpha cancels in the ratio; zero-alpha hidden RGB
              // remains original, including when quantization makes output alpha zero.
              if (applyForeground && foregroundStrength > 0 && output.data[src + 3] > 0) {
                for (let c = 0; c < 3; c++) {
                  const from = original.data[src + c], to = foreground.data[p * 4 + c];
                  if (from !== to) {
                    const sourceLinear = linear(from), foregroundLinear = sourceLinear + foregroundStrength * (linear(to) - sourceLinear);
                    output.data[src + c] = srgb(((1 - weight) * sourceLinear + weight * patch.data[p] * foregroundLinear) / alphaFactor);
                  }
                }
              }
            } else {
              for (let c = 0; c < 3; c++) output.data[src + c] = Math.round(original.data[src + c] + weight * (patch.data[p * 4 + c] - original.data[src + c]));
            }
          }
        }
        settle('succeeded', Object.freeze({ jobId: id, task, status: 'completed', provenance, image: output }));
      } catch (error) {
        if (settled) return;
        settle('failed', undefined, error instanceof BackendContractError ? error : new BackendContractError('INFERENCE_FAILED', 'Selected adapter failed; no fallback was used.', { cause: error }));
      }
    });
    return job;
  }

  return Object.freeze({
    start,
    getOriginal() { requireOpen(); return imageSnapshot(original, maxPixels, 'Original image'); },
    listModels() { return Object.freeze([...registry.values()].map(entry => entry.descriptor)); },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (active) active.cancel();
      original = null;
    }
  });
}

module.exports = Object.freeze({ TASKS, DEFAULT_MAX_PIXELS, BackendContractError, createBackendSession });
