'use strict';
const crypto = require('node:crypto');
const MAX_PIXELS = 16777216;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
class GenerativeError extends Error {
  constructor(code, message) { super(message); this.name = 'GenerativeError'; this.code = code; }
}
function fail(code, message) { throw new GenerativeError(code, message); }
function abort(signal) { if (signal?.aborted) fail('CANCELLED', 'Generation was cancelled. Provider billing may already have started.'); }
function cleanError(error) {
  // Never propagate a provider body, URL, key, prompt or fetch exception to the renderer/log.
  return error instanceof GenerativeError ? error : new GenerativeError('GENERATION_FAILED', 'Generation failed; no retry or fallback was performed.');
}
function image(value) {
  const { width, height, data } = value || {};
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS ||
      value.format !== 'rgba8' || value.alphaMode !== 'straight' || value.colorSpace !== 'srgb' ||
      !(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || !(data.buffer instanceof ArrayBuffer) || data.length !== width * height * 4) {
    fail('INVALID_IMAGE', 'Expected bounded, unshared straight-alpha sRGB RGBA8 pixels.');
  }
  return Object.freeze({ width, height, format: 'rgba8', alphaMode: 'straight', colorSpace: 'srgb', data: new Uint8ClampedArray(data) });
}
function mask(value, source) {
  if (!value || value.width !== source.width || value.height !== source.height || value.space !== 'original-pixels' ||
      value.encoding !== 'unit-float32' || !(value.data instanceof Float32Array) || !(value.data.buffer instanceof ArrayBuffer) || value.data.length !== source.width * source.height) {
    fail('INVALID_MASK', 'Expected an explicit full-original-size unit-float32 mask.');
  }
  const data = new Float32Array(value.data);
  for (const v of data) if (!Number.isFinite(v) || v < 0 || v > 1) fail('INVALID_MASK', 'Mask values must be finite and in [0, 1].');
  return Object.freeze({ width: source.width, height: source.height, space: 'original-pixels', encoding: 'unit-float32', data });
}
function string(value, name, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000]/.test(value)) fail('INVALID_REQUEST', `Invalid ${name}.`);
  return value;
}
function png(value, maxBytes = MAX_OUTPUT_BYTES) {
  if (!(value instanceof Uint8Array) || value.length < 24 || value.length > maxBytes) fail('INVALID_OUTPUT', 'Image bytes exceed the allowed size or are missing.');
  const b = Buffer.from(value);
  if (!b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || b.toString('ascii',12,16) !== 'IHDR') fail('INVALID_OUTPUT', 'Only PNG output is accepted.');
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20);
  if (!width || !height || width * height > MAX_PIXELS) fail('INVALID_OUTPUT', 'PNG dimensions exceed the pixel budget.');
  return { bytes: b, width, height };
}
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
async function readLimited(response, maxBytes) {
  const declared = Number(response.headers?.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await response.body?.cancel(); } catch {}
    fail('INVALID_OUTPUT', 'Provider response exceeds the byte budget.');
  }
  if (!response.body?.getReader) fail('INVALID_OUTPUT', 'A bounded streaming response is required.');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); fail('INVALID_OUTPUT', 'Provider response exceeds the byte budget.'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}
async function json(response) {
  if (!response.ok) { try { await response.body?.cancel(); } catch {} fail('PROVIDER_ERROR', `Provider request failed (HTTP ${Number(response.status) || 0}); no automatic retry.`); }
  try { return JSON.parse((await readLimited(response, 48 * 1024 * 1024)).toString('utf8')); }
  catch (e) { if (e instanceof GenerativeError) throw e; fail('INVALID_OUTPUT', 'Provider returned invalid JSON.'); }
}
function requestId(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value) ? value : null; }
module.exports = { MAX_PIXELS, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, GenerativeError, fail, abort, cleanError, image, mask, string, png, sha, readLimited, json, requestId };
