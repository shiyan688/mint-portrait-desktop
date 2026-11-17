/* Read-only 8-bit sRGB preview coordinates and RGBA values. No image processing. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MintPreviewPixelInspector = api;
})(typeof globalThis === 'object' ? globalThis : null, function () {
  'use strict';
  const LIMITS = Object.freeze({ maxEdge: 1280, maxBytes: 1280 * 1280 * 4 });
  const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
  const typedGet = Object.fromEntries(['length', 'buffer', 'byteLength', 'byteOffset'].map(key => [key, Object.getOwnPropertyDescriptor(typedPrototype, key).get]));
  const bufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  const bufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable');
  function check(condition, message) { if (!condition) throw new TypeError(message); }
  function record(value, keys, label) {
    check(value !== null && typeof value === 'object' && !Array.isArray(value), `Invalid ${label}`);
    const prototype = Object.getPrototypeOf(value);
    check(prototype === Object.prototype || prototype === null, `Invalid ${label} prototype`);
    const own = Reflect.ownKeys(value);
    check(own.length === keys.length, `Invalid ${label} fields`);
    const out = Object.create(null);
    for (const key of own) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      check(typeof key === 'string' && keys.includes(key) && descriptor?.enumerable && Object.hasOwn(descriptor, 'value'), `Invalid ${label} field`);
      out[key] = descriptor.value;
    }
    for (const key of keys) check(Object.hasOwn(out, key), `Missing ${label} field`);
    return out;
  }
  function finite(value, limit = 10000000) { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit; }
  function boundedSize(width, height) {
    check(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= LIMITS.maxEdge && height <= LIMITS.maxEdge && width * height * 4 <= LIMITS.maxBytes, 'Preview dimensions exceed 1280 pixels / 6.25 MiB');
    return { width, height, bytes: width * height * 4 };
  }
  function rectangle(value, label) {
    const r = record(value, ['left', 'top', 'width', 'height'], label);
    check(finite(r.left) && finite(r.top) && finite(r.width, 100000) && finite(r.height, 100000) && r.width > 0 && r.height > 0, `Invalid ${label} dimensions`);
    return r;
  }
  function mapPoint(point, imageRect, viewportRect, size) {
    const p = record(point, ['x', 'y'], 'pointer'), s = record(size, ['width', 'height'], 'preview size');
    boundedSize(s.width, s.height);
    check(finite(p.x) && finite(p.y), 'Invalid pointer coordinates');
    const image = rectangle(imageRect, 'image rectangle'), viewport = rectangle(viewportRect, 'viewport rectangle');
    // Deliberately half-open on BOTH rectangles. Outside-image pointers are not
    // clamped to an edge pixel, including when pointer capture leaves the viewport.
    for (const r of [image, viewport]) if (p.x < r.left || p.y < r.top || p.x >= r.left + r.width || p.y >= r.top + r.height) return null;
    const x = Math.floor((p.x - image.left) / image.width * s.width), y = Math.floor((p.y - image.top) / image.height * s.height);
    // Floating-point cancellation must fail closed, never produce/clamp an edge.
    return x >= 0 && y >= 0 && x < s.width && y < s.height ? { x, y } : null;
  }
  function samplePixel(image, x, y) {
    const im = record(image, ['width', 'height', 'data'], 'RGBA8 preview');
    const size = boundedSize(im.width, im.height), data = im.data;
    check(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < size.width && y < size.height, 'Pixel outside preview');
    check(data && typeof data === 'object', 'Invalid RGBA8 storage');
    const prototype = Object.getPrototypeOf(data);
    check(prototype === Uint8Array.prototype || prototype === Uint8ClampedArray.prototype, 'Expected native Uint8Array or Uint8ClampedArray');
    // Intrinsics reject proxies, detached/shared/resizable storage and bypass
    // shadowed getters without scanning/copying all pixels on every movement.
    const length = typedGet.length.call(data), bytes = typedGet.byteLength.call(data), offset = typedGet.byteOffset.call(data), buffer = typedGet.buffer.call(data);
    const backing = bufferByteLength.call(buffer);
    check(length === size.bytes && bytes === length && backing > 0 && offset + length <= backing && backing <= LIMITS.maxBytes, 'Invalid or oversized RGBA8 storage');
    check(!bufferResizable || !bufferResizable.get.call(buffer), 'Resizable RGBA8 storage unsupported');
    const index = (y * size.width + x) * 4, a = data[index + 3];
    const rgb = a === 0 ? [null, null, null] : [data[index], data[index + 1], data[index + 2]];
    const channels = ['R', 'G', 'B'];
    return { x, y, r: rgb[0], g: rgb[1], b: rgb[2], a, alphaMode: a === 0 ? 'transparent' : a === 255 ? 'opaque' : 'partial', zeroChannels: channels.filter((_, i) => rgb[i] === 0), fullChannels: channels.filter((_, i) => rgb[i] === 255) };
  }
  return Object.freeze({ LIMITS, boundedSize, mapPoint, samplePixel });
});
