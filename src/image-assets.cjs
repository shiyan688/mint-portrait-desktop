/* MintImageAssets v1. Content-addressed, canonical RGBA8 records; no files or URLs. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (typeof define === 'function' && define.amd) define([], function () { return api; });
  else root.MintImageAssets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LIMITS = Object.freeze({ maxAssetEdge: 1024, maxAssetPixels: 1048576,
    maxAssetBytes: 4194304, maxAssetBase64Chars: 5592408,
    maxPhotoRecords: 16, maxPhotoBytes: 32 * 1024 * 1024,
    maxSessionRecords: 128, maxSessionBytes: 64 * 1024 * 1024 });
  const ID = /^rgba-[a-f0-9]{64}$/;
  const RECORD_KEYS = ['id', 'version', 'width', 'height', 'data'];
  const own = Function.call.bind(Object.prototype.hasOwnProperty);
  const typedProto = Object.getPrototypeOf(Uint8Array.prototype);
  const getBuffer = Object.getOwnPropertyDescriptor(typedProto, 'buffer').get;
  const getLength = Object.getOwnPropertyDescriptor(typedProto, 'length').get;
  const getByteOffset = Object.getOwnPropertyDescriptor(typedProto, 'byteOffset').get;
  const getBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable');
  function fail(message, code) { const e = new TypeError(message); e.code = 'IMAGE_ASSET_' + (code || 'INVALID'); throw e; }
  function record(input, keys, required, label) {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail(label + ' must be a plain own-data record');
    const names = Reflect.ownKeys(input), out = Object.create(null);
    if (names.length > keys.length) fail(label + ' has unexpected fields');
    for (const key of names) {
      if (typeof key !== 'string' || !keys.includes(key)) fail(label + ' has unexpected fields');
      const d = Object.getOwnPropertyDescriptor(input, key);
      if (!d || !d.enumerable || !own(d, 'value')) fail(label + ' has hidden or accessor fields');
      out[key] = d.value;
    }
    for (const key of required) if (!own(out, key)) fail(label + ' is missing ' + key);
    return out;
  }
  function fixedBytes(value, label, clamped) {
    if (!value || (Object.getPrototypeOf(value) !== Uint8Array.prototype &&
        (!clamped || Object.getPrototypeOf(value) !== Uint8ClampedArray.prototype))) fail(label + ' must be a local fixed byte array');
    for (const key of ['length', 'buffer', 'byteLength', 'byteOffset', Symbol.iterator])
      if (own(value, key)) fail(label + ' has an overridden binary property');
    let buffer, length, offset;
    try { buffer = getBuffer.call(value); length = getLength.call(value); offset = getByteOffset.call(value); getBufferLength.call(buffer); }
    catch (_) { fail(label + ' has a detached or shared buffer'); }
    if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype ||
        (resizable && resizable.get.call(buffer))) fail(label + ' has a shared, resizable or subclassed buffer');
    for (const key of ['byteLength', 'resizable', 'maxByteLength']) if (own(buffer, key)) fail(label + ' has an overridden buffer property');
    return { buffer, length, offset };
  }
  function dimensionCheck(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width > LIMITS.maxAssetEdge || height > LIMITS.maxAssetEdge || width * height > LIMITS.maxAssetPixels)
      fail('Asset dimensions exceed the bounded RGBA working size', 'LIMIT');
  }
  function createCodec(options) {
    const opts = record(options, ['overlay', 'digest'], ['overlay'], 'Codec options');
    const overlay = opts.overlay;
    if (!overlay || typeof overlay !== 'object') fail('A trusted MintImageOverlay implementation is required');
    const methods = {};
    for (const name of ['validateAsset', 'encodeAsset', 'decodeAsset']) {
      const d = Object.getOwnPropertyDescriptor(overlay, name);
      if (!d || !own(d, 'value') || typeof d.value !== 'function') fail('Invalid overlay codec');
      methods[name] = d.value;
    }
    if (own(opts, 'digest') && typeof opts.digest !== 'function') fail('digest must be a trusted function');
    const injectedDigest = opts.digest;
    function validate(value) {
      const input = record(value, RECORD_KEYS, RECORD_KEYS, 'Image asset');
      if (typeof input.id !== 'string' || !ID.test(input.id)) fail('Invalid dimension-bound RGBA asset ID');
      dimensionCheck(input.width, input.height);
      const asset = methods.validateAsset({ version: input.version, width: input.width, height: input.height, data: input.data });
      return Object.freeze({ id: input.id, version: 1, width: asset.width, height: asset.height, data: asset.data });
    }
    function validateTable(input) {
      if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > LIMITS.maxPhotoRecords)
        fail('Invalid or excessive asset table', 'LIMIT');
      const length = Object.getOwnPropertyDescriptor(input, 'length');
      if (!length || !own(length, 'value') || Reflect.ownKeys(input).length !== length.value + 1) fail('Sparse or extended asset table');
      const out = [], ids = new Map(); let bytes = 0;
      for (let i = 0; i < length.value; i++) {
        const d = Object.getOwnPropertyDescriptor(input, String(i));
        if (!d || !d.enumerable || !own(d, 'value')) fail('Asset table contains holes or accessors');
        const item = validate(d.value), previous = ids.get(item.id);
        if (previous && (previous.width !== item.width || previous.height !== item.height || previous.data !== item.data))
          fail('Conflicting duplicate asset ID', 'CONFLICT');
        ids.set(item.id, item); bytes += item.width * item.height * 4;
        if (bytes > LIMITS.maxPhotoBytes) fail('Asset table exceeds retained RGBA byte limit', 'LIMIT');
        out.push(item);
      }
      return Object.freeze(out);
    }
    function toOverlayAsset(value) {
      const asset = validate(value);
      return Object.freeze({ version: 1, width: asset.width, height: asset.height, data: asset.data });
    }
    function toRaw(value) { return methods.decodeAsset(toOverlayAsset(value)); }
    function captureImage(value) {
      const input = record(value, ['width', 'height', 'data'], ['width', 'height', 'data'], 'RGBA image');
      dimensionCheck(input.width, input.height);
      const bytes = fixedBytes(input.data, 'RGBA data', true);
      if (bytes.length !== input.width * input.height * 4) fail('RGBA length does not match dimensions');
      // Built-in set reads typed elements, not user-shadowed properties or iterators.
      const data = new Uint8Array(bytes.length);
      Uint8Array.prototype.set.call(data, new Uint8Array(bytes.buffer, bytes.offset, bytes.length));
      return { width: input.width, height: input.height, data };
    }
    function identityCaptured(image) {
      // This ASCII string is exactly its UTF-8 representation, including the NUL.
      const prefix = 'mint-rgba-asset-v1\0', out = new Uint8Array(prefix.length + 8 + image.data.length);
      for (let i = 0; i < prefix.length; i++) out[i] = prefix.charCodeAt(i);
      const view = new DataView(out.buffer); view.setUint32(prefix.length, image.width, true); view.setUint32(prefix.length + 4, image.height, true);
      Uint8Array.prototype.set.call(out, image.data, prefix.length + 8); return out;
    }
    function identityBytes(value) { return identityCaptured(captureImage(value)); }
    async function identity(image) {
      const bytes = identityCaptured(image); let result;
      if (injectedDigest) result = await injectedDigest(bytes);
      else if (typeof require === 'function') result = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
      else if (typeof globalThis.crypto === 'object' && globalThis.crypto.subtle)
        result = new Uint8Array(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))); // Own local fixed storage, including isolated WebCrypto realms.
      else fail('SHA-256 is unavailable', 'HASH_UNAVAILABLE');
      if (typeof result !== 'string') {
        const b = fixedBytes(result, 'SHA-256 result', false);
        if (b.length !== 32) fail('SHA-256 result must contain exactly 32 bytes');
        const snapshot = new Uint8Array(b.buffer, b.offset, b.length); let hex = '';
        for (let i = 0; i < snapshot.length; i++) hex += snapshot[i].toString(16).padStart(2, '0');
        result = hex;
      }
      if (!/^[a-f0-9]{64}$/.test(result)) fail('SHA-256 result must be canonical lowercase hex or 32 fixed bytes');
      return 'rgba-' + result;
    }
    async function createAsset(value) {
      // Everything provided by the caller is captured before the first await.
      const image = captureImage(value), encoded = methods.encodeAsset(image), id = await identity(image);
      return Object.freeze({ id, version: 1, width: encoded.width, height: encoded.height, data: encoded.data });
    }
    async function verify(value) {
      const asset = validate(value), image = methods.decodeAsset(toOverlayAsset(asset));
      if (await identity(image) !== asset.id) fail('RGBA asset identity does not match dimensions and pixels', 'IDENTITY');
      return asset;
    }
    async function fromRaw(value) {
      const input = record(value, ['id', 'width', 'height', 'data'], ['id', 'width', 'height', 'data'], 'Raw asset');
      if (typeof input.id !== 'string' || !ID.test(input.id)) fail('Invalid RGBA asset ID');
      const claimed = input.id, created = await createAsset({ width: input.width, height: input.height, data: input.data });
      if (created.id !== claimed) fail('Raw RGBA asset identity mismatch', 'IDENTITY');
      return created;
    }
    return Object.freeze({ validate, validateTable, toOverlayAsset, toRaw, identityBytes, createAsset, verify, fromRaw });
  }
  return Object.freeze({ LIMITS, createCodec });
});
