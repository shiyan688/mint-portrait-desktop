'use strict';
// Encoded container checks run before Sharp metadata or pixel decoding.
const { inflateSync, crc32 } = require('node:zlib');
const LIMITS = Object.freeze({ maxEncodedBytes: 32 * 1024 * 1024, maxInputPixels: 24000000,
  maxInputEdge: 8192, maxAssetEdge: 1024, maxAssetPixels: 1048576,
  maxProfileBytes: 1024 * 1024, maxExifBytes: 1024 * 1024, maxChunks: 100000,
  workerTimeoutMs: 90000 });
function fail(message, code = 'INVALID') { const e = new Error(message); e.code = 'IMAGE_IMPORT_' + code; throw e; }
function check(value, message, code) { if (!value) fail(message, code); }
function fixedEncoded(value, copy = false) {
  const proto = value && Object.getPrototypeOf(value);
  check(proto === Uint8Array.prototype || proto === Buffer.prototype, 'Encoded image must be fixed bytes');
  for (const key of ['buffer', 'byteOffset', 'byteLength', 'length', Symbol.iterator]) check(!Object.hasOwn(value, key), 'Overridden byte property');
  const tp = Object.getPrototypeOf(Uint8Array.prototype);
  let buffer, offset, length;
  try {
    buffer = Object.getOwnPropertyDescriptor(tp, 'buffer').get.call(value);
    offset = Object.getOwnPropertyDescriptor(tp, 'byteOffset').get.call(value);
    length = Object.getOwnPropertyDescriptor(tp, 'byteLength').get.call(value);
    Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get.call(buffer);
  } catch (_) { fail('Detached or shared encoded image'); }
  const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable');
  check(Object.getPrototypeOf(buffer) === ArrayBuffer.prototype && !(resizable && resizable.get.call(buffer)), 'Shared, resizable or subclassed encoded buffer');
  check(length > 0 && length <= LIMITS.maxEncodedBytes, 'Encoded image exceeds 32 MiB', 'LIMIT');
  return copy ? new Uint8Array(new Uint8Array(buffer, offset, length)) : new Uint8Array(buffer, offset, length);
}
function text(bytes, start, count) { let out = ''; for (let i = 0; i < count; i++) out += String.fromCharCode(bytes[start + i]); return out; }
function dimensions(width, height) {
  check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 &&
    width <= LIMITS.maxInputEdge && height <= LIMITS.maxInputEdge && width * height <= LIMITS.maxInputPixels,
    'Input image exceeds 8192 edge or 24 megapixels', 'LIMIT');
}
function pngGuard(bytes, view) {
  check(bytes.length >= 45 && text(bytes, 0, 8) === '\x89PNG\r\n\x1a\n', 'Invalid PNG signature');
  check(view.getUint32(8) === 13 && text(bytes, 12, 4) === 'IHDR', 'Invalid PNG IHDR');
  dimensions(view.getUint32(16), view.getUint32(20));
  let p = 8, count = 0, ended = false, imageData = false, profile = false, exif = false;
  while (p < bytes.length) {
    check(p <= bytes.length - 12 && ++count <= LIMITS.maxChunks, 'Invalid PNG chunk bounds');
    const length = view.getUint32(p), type = text(bytes, p + 4, 4), start = p + 8;
    check(length <= bytes.length - p - 12, 'Truncated PNG chunk');
    check(/^[A-Za-z]{4}$/.test(type) && (bytes[p + 6] & 32) === 0, 'Invalid PNG chunk type');
    check(crc32(bytes.subarray(p + 4, start + length)) === view.getUint32(start + length), 'Invalid PNG chunk checksum');
    check(!['acTL', 'fcTL', 'fdAT'].includes(type), 'Animated PNG is unsupported', 'ANIMATED');
    if (type === 'IHDR') check(p === 8, 'Duplicate PNG IHDR');
    if (type === 'IDAT') imageData = true;
    if (type === 'eXIf') { check(!exif && length <= LIMITS.maxExifBytes, 'Invalid PNG EXIF size'); exif = true; }
    if (type === 'iCCP') {
      check(!profile && length <= LIMITS.maxProfileBytes, 'Invalid PNG ICC size'); profile = true;
      let end = start; while (end < start + length && bytes[end] !== 0) end++;
      check(end > start && end - start <= 79 && end + 2 < start + length && bytes[end + 1] === 0, 'Invalid PNG ICC header');
      try { inflateSync(bytes.subarray(end + 2, start + length), { maxOutputLength: LIMITS.maxProfileBytes }); }
      catch (_) { fail('Invalid or excessive compressed PNG ICC profile', 'LIMIT'); }
    }
    if (type === 'IEND') { check(length === 0 && p + 12 === bytes.length && imageData, 'Invalid PNG end'); ended = true; }
    p += length + 12;
  }
  check(ended, 'PNG IEND is missing');
}
function jpegGuard(bytes, view) {
  check(bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216, 'Invalid JPEG signature');
  let p = 2, scans = 0, frames = 0, count = 0, entropy = false, ended = false, iccBytes = 0;
  while (p < bytes.length) {
    if (entropy) {
      while (p < bytes.length && bytes[p] !== 255) p++;
      check(p < bytes.length, 'JPEG end marker is missing');
    }
    check(bytes[p++] === 255 && ++count <= LIMITS.maxChunks, 'Invalid JPEG marker');
    while (p < bytes.length && bytes[p] === 255) p++;
    check(p < bytes.length, 'Truncated JPEG marker'); const marker = bytes[p++];
    if (entropy && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
    entropy = false;
    if (marker === 0xd9) { check(scans > 0 && frames === 1 && p === bytes.length, 'Trailing or incomplete JPEG data'); ended = true; break; }
    check(marker !== 0xd8 && marker !== 0 && !(marker >= 0xd0 && marker <= 0xd7), 'Unexpected JPEG standalone marker');
    if (marker === 0x01) continue;
    check(p <= bytes.length - 2, 'Truncated JPEG segment'); const length = view.getUint16(p);
    check(length >= 2 && length <= bytes.length - p, 'Truncated JPEG segment');
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      check(++frames === 1 && length >= 8, 'Multiple or malformed JPEG frames'); dimensions(view.getUint16(p + 5), view.getUint16(p + 3));
    }
    if (marker === 0xe2 && length >= 6 && text(bytes, p + 2, 4) === 'MPF\0') fail('Multi-picture JPEG is unsupported', 'ANIMATED');
    if (marker === 0xe2 && length >= 14 && text(bytes, p + 2, 12) === 'ICC_PROFILE\0') {
      iccBytes += length; check(iccBytes <= LIMITS.maxProfileBytes, 'Excessive JPEG ICC profile', 'LIMIT');
    }
    p += length;
    if (marker === 0xda) { check(frames === 1, 'JPEG scan precedes frame'); scans++; entropy = true; }
  }
  check(ended, 'JPEG end marker is missing');
}
function webpGuard(bytes, view) {
  check(bytes.length >= 20 && text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'WEBP' && view.getUint32(4, true) === bytes.length - 8, 'Invalid WebP container');
  let p = 12, count = 0, frame = null, canvas = null, profile = false, exif = false;
  while (p < bytes.length) {
    check(p <= bytes.length - 8 && ++count <= LIMITS.maxChunks, 'Invalid WebP chunk bounds');
    const type = text(bytes, p, 4), length = view.getUint32(p + 4, true), start = p + 8;
    check(length <= bytes.length - start && start + length + (length & 1) <= bytes.length, 'Truncated WebP chunk');
    check(type !== 'ANIM' && type !== 'ANMF', 'Animated WebP is unsupported', 'ANIMATED');
    if (type === 'VP8X') {
      check(!canvas && p === 12 && length === 10, 'Invalid WebP canvas');
      check((bytes[start] & 2) === 0, 'Animated WebP is unsupported', 'ANIMATED');
      canvas = { width: 1 + bytes[start + 4] + bytes[start + 5] * 256 + bytes[start + 6] * 65536,
        height: 1 + bytes[start + 7] + bytes[start + 8] * 256 + bytes[start + 9] * 65536 };
      dimensions(canvas.width, canvas.height);
    }
    if (type === 'VP8 ' || type === 'VP8L') {
      check(!frame, 'Multiple WebP image payloads');
      if (type === 'VP8 ') {
        check(length >= 10 && (bytes[start] & 1) === 0 && bytes[start + 3] === 0x9d && bytes[start + 4] === 1 && bytes[start + 5] === 0x2a, 'Invalid WebP VP8 frame');
        frame = { width: view.getUint16(start + 6, true) & 0x3fff, height: view.getUint16(start + 8, true) & 0x3fff };
      } else {
        check(length >= 5 && bytes[start] === 0x2f, 'Invalid WebP lossless frame');
        const bits = view.getUint32(start + 1, true); frame = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      dimensions(frame.width, frame.height);
    }
    if (type === 'ICCP') { check(!profile && length <= LIMITS.maxProfileBytes, 'Invalid WebP ICC size'); profile = true; }
    if (type === 'EXIF') { check(!exif && length <= LIMITS.maxExifBytes, 'Invalid WebP EXIF size'); exif = true; }
    p = start + length + (length & 1);
  }
  check(frame && (!canvas || (canvas.width === frame.width && canvas.height === frame.height)), 'WebP canvas/payload dimension mismatch');
}
function inspectEncoded(value, inspectImage) {
  check(typeof inspectImage === 'function', 'A trusted read-only header inspector is required');
  const bytes = fixedEncoded(value), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let mime;
  if (bytes[0] === 137) { mime = 'image/png'; pngGuard(bytes, view); }
  else if (bytes[0] === 255) { mime = 'image/jpeg'; jpegGuard(bytes, view); }
  else if (text(bytes, 0, 4) === 'RIFF') { mime = 'image/webp'; webpGuard(bytes, view); }
  else fail('Only JPEG, PNG and WebP are supported', 'FORMAT');
  let result;
  try { result = inspectImage(bytes, mime); } catch (_) { fail('Malformed or truncated image header'); }
  dimensions(result.width, result.height); dimensions(result.encodedWidth, result.encodedHeight);
  check(Number.isSafeInteger(result.orientation) && result.orientation >= 1 && result.orientation <= 8, 'Invalid image orientation');
  return Object.freeze({ mime, width: result.width, height: result.height, encodedWidth: result.encodedWidth,
    encodedHeight: result.encodedHeight, orientation: result.orientation });
}
function decoderBytes(value) {
  const bytes = fixedEncoded(value);
  if (bytes[0] !== 137) return bytes;
  // Drop text and unknown ancillary PNG chunks before native metadata parsing.
  // Retain EXIF orientation and bounded ICC/color chunks for correct conversion.
  const allowed = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sRGB', 'eXIf', 'sBIT']);
  const parts = [bytes.subarray(0, 8)], view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let p = 8; p < bytes.length;) {
    const length = view.getUint32(p), type = text(bytes, p + 4, 4);
    if (allowed.has(type) || (bytes[p + 4] & 32) === 0) parts.push(bytes.subarray(p, p + length + 12));
    p += length + 12;
  }
  return new Uint8Array(Buffer.concat(parts));
}
function sizePlan(width, height) {
  dimensions(width, height); const scale = Math.min(1, LIMITS.maxAssetEdge / Math.max(width, height));
  return Object.freeze({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), resized: scale < 1 });
}
module.exports = Object.freeze({ LIMITS, fail, check, fixedEncoded, inspectEncoded, decoderBytes, sizePlan });
