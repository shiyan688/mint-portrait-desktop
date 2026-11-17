/* Mint Portrait project format v17 (reads v1 through v16). Pure bounded data codec: no image/model execution,
 * filesystem, paths, URL resolution, API calls, or source-image rewriting. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MintProjectDocument = api;
})(typeof globalThis === 'object' ? globalThis : null, function () {
  'use strict';
  const MiB = 1024 * 1024;
  const LIMITS = Object.freeze({
    maxPhotos: 100, maxPhotoBytes: 80 * MiB, maxSourceBytes: 400 * MiB,
    maxCacheBytes: 256 * MiB, maxMetadataBytes: 16 * MiB, maxContainerBytes: 672 * MiB + 64,
    maxHistory: 40, maxCacheEntries: 512, maxSourceEdge: 65535, maxSourcePixels: 268000000,
    maxLearnedEdge: 4096, maxLearnedPixels: 16000000, maxParsePixels: 1048576,
    maxStrokes: 64, maxPointsPerStroke: 512, maxBrushWork: 64000000,
    maxJsonNodes: 1000000, maxProvenanceBytes: 32768,
    maxImageAssetEdge: 1024, maxImageAssetPixels: 1048576, maxImageAssetBytes: 4 * MiB,
    maxPhotoImageAssets: 16, maxPhotoImageAssetBytes: 32 * MiB,
    maxImageAssets: 128, maxImageAssetBytesTotal: 64 * MiB
  });
  const MAGIC = new Uint8Array([77, 73, 78, 84, 80, 82, 74, 0]); // MINTPRJ\0
  const VERSION = 17, HEADER_BYTES = 64;
  const MAX_BLOBS = LIMITS.maxPhotos + LIMITS.maxCacheEntries * 2 + LIMITS.maxImageAssets;
  const HOST_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const FACE_CLASSES = Object.freeze(['background', 'neck', 'skin', 'cloth', 'l_ear', 'r_ear', 'l_brow', 'r_brow', 'l_eye', 'r_eye', 'nose', 'mouth', 'l_lip', 'u_lip', 'hair', 'eye_g', 'hat', 'ear_r', 'neck_l']);
  const DEFAULT_SETTINGS = Object.freeze({ exposure: 0, contrast: 0, saturation: 0, temperature: 0, smooth: 0, brighten: 0, warmth: 0, slim: 0, eyes: 0, nose: 0, jaw: 0, bgMode: 'original', bgBlur: 18, bgColor: '#e9eee9', bgFeather: 2, spots: Object.freeze([]), underEye: 0, redness: 0, lip: 0, blush: 0, palette: 'natural', localLayers: Object.freeze([]), manualSelection: null, manualLiquify: Object.freeze([]), manualRepair: Object.freeze([]), lightBalance: null, levels: null, advancedTone: null, sharpness: null, framing: null, straighten: null, perspective: null, canvasPadding: null, textLayers: Object.freeze([]), imageLayers: Object.freeze([]), paintLayers: null, redactions: null, faceAdjustments: null });
  const SETTINGS_KEYS = [...Object.keys(DEFAULT_SETTINGS), 'learnedMatteId', 'learnedMatteStrokes', 'diagnosticParseId', 'diagnosticOverlay', 'diagnosticLayer'];
  const HASH_RE = /^[a-f0-9]{64}$/;
  const ASSET_ID_RE = /^rgba-[a-f0-9]{64}$/;
  class ProjectFormatError extends Error {
    constructor(message, code = 'INVALID_PROJECT') { super(message); this.name = 'ProjectFormatError'; this.code = code; }
  }
  const fail = (message, code) => { throw new ProjectFormatError(message, code); };
  const check = (condition, message, code) => { if (!condition) fail(message, code); };
  function integer(value, min, max, label) { check(Number.isSafeInteger(value) && value >= min && value <= max, `Invalid ${label}`); return value; }
  function number(value, min, max, label) { check(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `Invalid ${label}`); return value; }
  function string(value, max, label, allowEmpty = false) { check(typeof value === 'string' && value.length <= max && (allowEmpty || value.length > 0) && !/[\u0000-\u001f\u007f]/.test(value), `Invalid ${label}`); return value; }
  function id(value, label) { string(value, 160, label); check(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value) && !BAD_KEYS.has(value), `Invalid ${label}`); return value; }
  function bool(value, label) { check(typeof value === 'boolean', `Invalid ${label}`); return value; }
  function hash(value, label) { check(typeof value === 'string' && HASH_RE.test(value), `Invalid ${label}`); return value; }
  function object(value, keys, label) {
    check(value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), `Invalid ${label} object`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      check(typeof key === 'string' && !BAD_KEYS.has(key) && (!keys || keys.includes(key)), `Unknown or unsafe ${label} field: ${String(key)}`);
      check('value' in descriptors[key] && descriptors[key].enumerable, `Accessors and hidden fields are not allowed in ${label}`);
    }
    return value;
  }
  function array(value, max, label) {
    check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= max, `Invalid or excessive ${label}`);
    const keys = Reflect.ownKeys(value);
    check(keys.length === value.length + 1, `Sparse or extended ${label} is not allowed`);
    for (const key of keys) {
      if (key === 'length') continue;
      check(typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length && Object.getOwnPropertyDescriptor(value, key).enumerable && 'value' in Object.getOwnPropertyDescriptor(value, key), `Unsafe ${label}`);
    }
    return value;
  }
  function checkBinaryObject(value, prototype, label, allowBuffer = false) {
    const proto = Object.getPrototypeOf(value);
    check(proto === prototype || (allowBuffer && typeof Buffer === 'function' && Buffer.isBuffer(value) && proto === Buffer.prototype), `Unsupported binary subclass for ${label}`);
    for (const key of ['buffer', 'byteLength', 'byteOffset', 'length', Symbol.iterator]) check(!Object.hasOwn(value, key), `Unsafe binary property for ${label}`);
  }
  function byteView(value, label) {
    if (value instanceof ArrayBuffer) { checkBinaryObject(value, ArrayBuffer.prototype, label); return new Uint8Array(value); }
    check(value instanceof Uint8Array, `Expected Uint8Array or ArrayBuffer for ${label}`);
    checkBinaryObject(value, Uint8Array.prototype, label, true);
    check(value.buffer instanceof ArrayBuffer, `Shared buffers are not allowed for ${label}`);
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  function dimensions(value, learned = false) {
    object(value, ['width', 'height'], 'dimensions');
    const width = integer(value.width, 1, learned ? LIMITS.maxLearnedEdge : LIMITS.maxSourceEdge, 'width');
    const height = integer(value.height, 1, learned ? LIMITS.maxLearnedEdge : LIMITS.maxSourceEdge, 'height');
    check(width * height <= (learned ? LIMITS.maxLearnedPixels : LIMITS.maxSourcePixels), 'Image pixel limit exceeded');
    return { width, height };
  }
  function region(value, size) {
    object(value, ['x', 'y', 'width', 'height'], 'ROI');
    const x = integer(value.x, 0, size.width - 1, 'ROI x'), y = integer(value.y, 0, size.height - 1, 'ROI y');
    return { x, y, width: integer(value.width, 1, size.width - x, 'ROI width'), height: integer(value.height, 1, size.height - y, 'ROI height') };
  }
  function budget(ctx, nodes = 1) { ctx.nodes += nodes; check(ctx.nodes <= LIMITS.maxJsonNodes, 'Project metadata complexity limit exceeded'); }
  function safeJson(value, ctx, depth = 0) {
    budget(ctx); check(depth <= 14, 'Project metadata nesting limit exceeded');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { check(Number.isFinite(value), 'Non-finite metadata number'); return value; }
    if (typeof value === 'string') { check(value.length <= 32768, 'Metadata string too long'); return value; }
    if (Array.isArray(value)) return array(value, 200000, 'metadata array').map(v => safeJson(v, ctx, depth + 1));
    object(value, null, 'metadata');
    const out = {};
    for (const key of Object.keys(value)) { check(key.length <= 160, 'Metadata key too long'); out[key] = key === 'geometryKey' && typeof value[key] === 'string' ? (check(value[key].length <= 262144, 'Geometry key string too long'), value[key]) : safeJson(value[key], ctx, depth + 1); }
    return out;
  }
  const bytesToHex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  const hexToBytes = value => new Uint8Array(value.match(/../g).map(n => parseInt(n, 16)));
  async function sha256(bytes, options) {
    let result;
    if (options?.sha256) { check(typeof options.sha256 === 'function', 'sha256 option must be a trusted function'); result = await options.sha256(bytes); }
    else if (globalThis.crypto?.subtle) result = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    else if (typeof require === 'function') result = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    else fail('SHA-256 is unavailable; no project was saved or opened', 'HASH_UNAVAILABLE');
    if (typeof result !== 'string') result = bytesToHex(byteView(result, 'SHA-256 result'));
    return hash(result, 'SHA-256 result');
  }
  function textAt(bytes, offset, count) { return String.fromCharCode(...bytes.subarray(offset, offset + count)); }
  function exifOrientation(bytes, start, length) {
    if (length >= 6 && textAt(bytes, start, 6) === 'Exif\0\0') { start += 6; length -= 6; }
    check(length >= 8 && start + length <= bytes.length, 'Invalid EXIF header');
    const view = new DataView(bytes.buffer, bytes.byteOffset + start, length), order = textAt(bytes, start, 2);
    check(order === 'II' || order === 'MM', 'Invalid EXIF byte order');
    const le = order === 'II'; check(view.getUint16(2, le) === 42, 'Invalid EXIF TIFF header');
    const offset = view.getUint32(4, le); check(offset >= 8 && offset <= length - 2, 'Invalid EXIF directory');
    const count = view.getUint16(offset, le); check(count <= 4096 && offset + 2 + count * 12 + 4 <= length, 'Invalid EXIF entry count');
    let orientation = 1, found = false;
    for (let i = 0; i < count; i++) {
      const p = offset + 2 + i * 12;
      if (view.getUint16(p, le) !== 0x112) continue;
      check(!found && view.getUint16(p + 2, le) === 3 && view.getUint32(p + 4, le) === 1, 'Invalid EXIF orientation entry');
      orientation = integer(view.getUint16(p + 8, le), 1, 8, 'EXIF orientation'); found = true;
    }
    return orientation;
  }
  /** Header geometry only, not an image decoder. EXIF orientation is applied to dimensions. */
  function inspectImage(value, mime) {
    const bytes = byteView(value, 'source image'); integer(bytes.length, 1, LIMITS.maxPhotoBytes, 'source byte size');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let width = 0, height = 0, orientation = 1, seenExif = false;
    const exif = (start, length) => { check(!seenExif, 'Multiple EXIF blocks are not supported'); seenExif = true; orientation = exifOrientation(bytes, start, length); };
    if (mime === 'image/png') {
      check(bytes.length >= 45 && bytes.subarray(0, 8).every((n, i) => n === [137,80,78,71,13,10,26,10][i]), 'PNG MIME/signature mismatch');
      check(view.getUint32(8) === 13 && textAt(bytes, 12, 4) === 'IHDR', 'Invalid PNG IHDR');
      width = view.getUint32(16); height = view.getUint32(20);
      let p = 8, ended = false, chunks = 0;
      while (p < bytes.length) {
        check(p <= bytes.length - 12 && ++chunks <= 100000, 'Invalid PNG chunk bounds');
        const length = view.getUint32(p), type = textAt(bytes, p + 4, 4);
        check(length <= bytes.length - p - 12, 'Truncated PNG chunk');
        if (type === 'eXIf') exif(p + 8, length);
        if (type === 'IEND') { check(length === 0, 'Invalid PNG IEND'); ended = true; break; }
        p += length + 12;
      }
      check(ended, 'PNG IEND is missing');
    } else if (mime === 'image/jpeg') {
      check(bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216, 'JPEG MIME/signature mismatch');
      let p = 2, markers = 0;
      while (p < bytes.length) {
        check(bytes[p++] === 255 && ++markers <= 100000, 'Invalid JPEG marker');
        while (p < bytes.length && bytes[p] === 255) p++;
        check(p < bytes.length, 'Truncated JPEG marker'); const marker = bytes[p++];
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        check(p <= bytes.length - 2, 'Truncated JPEG segment'); const length = view.getUint16(p);
        check(length >= 2 && length <= bytes.length - p, 'Invalid JPEG segment length');
        if (marker === 0xe1 && length >= 8 && textAt(bytes, p + 2, 6) === 'Exif\0\0') exif(p + 2, length - 2);
        if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
          check(!width && length >= 8, 'Invalid or duplicate JPEG frame'); height = view.getUint16(p + 3); width = view.getUint16(p + 5);
        }
        p += length;
      }
      check(width && height, 'JPEG frame dimensions are missing');
    } else if (mime === 'image/webp') {
      check(bytes.length >= 20 && textAt(bytes, 0, 4) === 'RIFF' && textAt(bytes, 8, 4) === 'WEBP' && view.getUint32(4, true) === bytes.length - 8, 'WebP MIME/signature or length mismatch');
      let p = 12, chunks = 0, sawCanvas = false;
      while (p < bytes.length) {
        check(p <= bytes.length - 8 && ++chunks <= 100000, 'Invalid WebP chunk bounds');
        const type = textAt(bytes, p, 4), length = view.getUint32(p + 4, true), start = p + 8;
        check(length <= bytes.length - start && start + length + (length & 1) <= bytes.length, 'Truncated WebP chunk');
        if (type === 'VP8X') {
          check(!sawCanvas && length === 10, 'Invalid WebP canvas'); sawCanvas = true;
          width = 1 + bytes[start + 4] + bytes[start + 5] * 256 + bytes[start + 6] * 65536;
          height = 1 + bytes[start + 7] + bytes[start + 8] * 256 + bytes[start + 9] * 65536;
        } else if (type === 'VP8 ' && !width) {
          check(length >= 10 && bytes[start + 3] === 0x9d && bytes[start + 4] === 1 && bytes[start + 5] === 0x2a, 'Invalid WebP VP8 header');
          width = view.getUint16(start + 6, true) & 0x3fff; height = view.getUint16(start + 8, true) & 0x3fff;
        } else if (type === 'VP8L' && !width) {
          check(length >= 5 && bytes[start] === 0x2f, 'Invalid WebP VP8L header');
          const bits = view.getUint32(start + 1, true); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
        } else if (type === 'EXIF') exif(start, length);
        p = start + length + (length & 1);
      }
      check(width && height, 'WebP dimensions are missing');
    } else fail('Only JPEG, PNG and WebP source images are supported');
    dimensions({ width, height });
    return { mime, encodedWidth: width, encodedHeight: height, orientation, width: orientation >= 5 ? height : width, height: orientation >= 5 ? width : height };
  }
  function settings(value, size, ctx, sourceRevision) {
    object(value, SETTINGS_KEYS, 'settings'); budget(ctx);
    if (ctx.requireLightBalance) check(Object.hasOwn(value, 'lightBalance'), 'Missing settings field: lightBalance');
    if (ctx.requireLevels) check(Object.hasOwn(value, 'levels'), 'Missing settings field: levels');
    if (ctx.requireCanvasPadding) check(Object.hasOwn(value, 'canvasPadding'), 'Missing settings field: canvasPadding');
    if (ctx.requireTextLayers) check(Object.hasOwn(value, 'textLayers'), 'Missing settings field: textLayers');
    if (ctx.requireRedactions) check(Object.hasOwn(value, 'redactions'), 'Missing settings field: redactions');
    if (ctx.requireFaceAdjustments) check(Object.hasOwn(value, 'faceAdjustments'), 'Missing settings field: faceAdjustments');
    if (ctx.requirePaintLayers) check(Object.hasOwn(value, 'paintLayers'), 'Missing settings field: paintLayers');
    if (ctx.requirePerspective) check(Object.hasOwn(value, 'perspective'), 'Missing settings field: perspective');
    if (ctx.requireStraighten) check(Object.hasOwn(value, 'straighten'), 'Missing settings field: straighten');
    if (ctx.requireSharpness) check(Object.hasOwn(value, 'sharpness'), 'Missing settings field: sharpness');
    if (ctx.requireImageLayers) check(Object.hasOwn(value, 'imageLayers'), 'Missing settings field: imageLayers');
    const out = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (!Object.hasOwn(value, key) && ['underEye','redness','lip','blush','palette','localLayers','manualSelection','manualLiquify','manualRepair','lightBalance','levels','advancedTone','sharpness','framing','straighten','perspective','canvasPadding','textLayers','imageLayers','paintLayers','redactions','faceAdjustments'].includes(key)) { out[key] = key === 'palette' ? 'natural' : ['manualSelection','lightBalance','levels','advancedTone','sharpness','framing','straighten','perspective','canvasPadding','paintLayers','redactions','faceAdjustments'].includes(key) ? null : ['localLayers','manualLiquify','manualRepair','textLayers','imageLayers'].includes(key) ? [] : 0; continue; }
      check(Object.hasOwn(value, key), `Missing settings field: ${key}`);
      if (key === 'redactions' || key === 'paintLayers' || key === 'faceAdjustments') {
        // Validate after all settings are canonical, so each history record binds
        // independently to its own geometry and the immutable photo revision.
        out[key] = null;
      } else if (key === 'imageLayers') {
        array(value[key], 4, 'image layers');
        check(!ctx.legacyImageAssets || !value[key].length, 'Image layers require project version 16');
        if (!value[key].length) { out[key] = []; continue; }
        const layers = typeof module === 'object' && module.exports ? require('./image-layers.cjs') : globalThis.MintImageLayers;
        check(layers && typeof layers.validate === 'function', 'Image layers validator is unavailable');
        try { out[key] = safeJson(layers.validate(value[key]), ctx); }
        catch (error) { fail(`Invalid image layers: ${error.message}`); }
      } else if (key === 'textLayers') {
        array(value[key], 8, 'text layers');
        if (!value[key].length) { out[key] = []; continue; }
        const text = typeof module === 'object' && module.exports ? require('./text-layers.cjs') : globalThis.MintTextLayers;
        check(text && typeof text.validate === 'function', 'Text layers validator is unavailable');
        try { out[key] = safeJson(text.validate(value[key]), ctx); }
        catch (error) { fail(`Invalid text layers: ${error.message}`); }
      } else if (key === 'canvasPadding') {
        if (value[key] === null) { out[key] = null; continue; }
        const padding = typeof module === 'object' && module.exports ? require('./canvas-padding.cjs') : globalThis.MintCanvasPadding;
        check(padding && typeof padding.validate === 'function', 'Canvas padding validator is unavailable');
        try { out[key] = safeJson(padding.validate(value[key]), ctx); }
        catch (error) { fail(`Invalid canvas padding: ${error.message}`); }
      } else if (key === 'sharpness') {
        if (value[key] === null) { out[key] = null; continue; }
        // Persistence validates data only, never decoded-pixel or execution caps.
        const sharpness = typeof module === 'object' && module.exports ? require('./sharpness.cjs') : globalThis.MintSharpness;
        check(sharpness && typeof sharpness.validate === 'function', 'Sharpness validator is unavailable');
        try { out[key] = safeJson(sharpness.validate(value[key]), ctx); }
        catch (error) { fail(`Invalid sharpness: ${error.message}`); }
      } else if (key === 'straighten') {
        if (value[key] === null) { out[key] = null; continue; }
        // The shared validator is metadata-only: do not plan or allocate a
        // render here, including when historical source sizes exceed its caps.
        // undefined is not null: shared validate(undefined) would default it.
        check(value[key] !== undefined, 'Invalid straighten: recipe must be null or a complete record');
        const straighten = typeof module === 'object' && module.exports ? require('./straighten.cjs') : globalThis.MintStraighten;
        check(straighten && typeof straighten.validate === 'function', 'Straighten validator is unavailable');
        try { out[key] = safeJson(straighten.validate(value[key]), ctx); }
        catch (error) { fail(`Invalid straighten: ${error.message}`); }
      } else if (key === 'perspective') {
        if (value[key] === null) { out[key] = null; continue; }
        check(value[key] !== undefined, 'Invalid perspective: recipe must be null or a complete record');
        const perspective = typeof module === 'object' && module.exports ? require('./perspective.cjs') : globalThis.MintPerspective;
        check(perspective && typeof perspective.validate === 'function' && typeof perspective.isActive === 'function', 'Perspective validator is unavailable');
        try {
          const recipe = perspective.validate(value[key]);
          check(!ctx.legacyPerspective || !perspective.isActive(recipe), 'Active perspective requires project version 17');
          out[key] = safeJson(recipe, ctx);
        } catch (error) { fail(`Invalid perspective: ${error.message}`); }
      } else if (key === 'framing') {
        if (value[key] === null) { out[key] = null; continue; }
        const geometry = typeof module === 'object' && module.exports ? require('./geometry.cjs') : globalThis.MintGeometry;
        check(geometry, 'Geometry validator is unavailable');
        try { out[key] = safeJson(geometry.validate(value[key]), ctx); }
        catch (error) { fail(`Invalid framing: ${error.message}`); }
      } else if (key === 'lightBalance') {
        if (value[key] === null) { out[key] = null; continue; }
        const light = typeof module === 'object' && module.exports ? require('./light-balance.cjs') : globalThis.MintLightBalance;
        check(light && typeof light.validate === 'function', 'Light balance validator is unavailable');
        try { out[key] = safeJson(light.validate(value[key]), ctx); }
        catch (error) { fail(`Invalid lightBalance: ${error.message}`); }
      } else if (key === 'levels') {
        if (value[key] === null) { out[key] = null; continue; }
        const levels = typeof module === 'object' && module.exports ? require('./levels.cjs') : globalThis.MintLevels;
        check(levels && typeof levels.validate === 'function', 'Levels validator is unavailable');
        try { out[key] = safeJson(levels.validate(value[key]), ctx); }
        catch (error) { fail(`Invalid levels: ${error.message}`); }
      } else if (key === 'advancedTone') {
        if (value[key] === null) { out[key] = null; continue; }
        const tone = typeof module === 'object' && module.exports ? require('./advanced-tone.cjs') : globalThis.MintAdvancedTone;
        check(tone, 'Advanced tone validator is unavailable');
        try { out[key] = safeJson(tone.validate(value[key]), ctx); }
        catch (error) { fail(`Invalid advanced tone: ${error.message}`); }
      } else if (['manualSelection','manualLiquify','manualRepair'].includes(key)) {
        if (key === 'manualSelection' && value[key] === null) { out[key] = null; continue; }
        if (key !== 'manualSelection') { array(value[key], 128, key); if (!value[key].length) { out[key] = []; continue; } }
        const manual = typeof module === 'object' && module.exports ? require('./manual-tools.cjs') : globalThis.MintManualTools;
        check(manual, 'Manual selection validator is unavailable');
        if (key === 'manualSelection') out[key] = safeJson(manual.validateSelection(value[key], {sourceRevision}), ctx);
        else if (key === 'manualLiquify') out[key] = safeJson(manual.validateLiquifyCommands(value[key], {sourceRevision}), ctx);
        else {
          const repair = typeof module === 'object' && module.exports ? require('./repair-brush-core.cjs') : globalThis.RepairBrushCore;
          check(repair, 'Manual repair validator is unavailable');
          out[key] = value[key].map(command => safeJson(repair.validate(command, {sourceRevision, manualTools:manual}), ctx));
          for (const command of out[key]) check(command.sourceRevision === sourceRevision, 'Repair stroke belongs to another source');
        }
      } else if (key === 'localLayers') {
        check(Array.isArray(value.localLayers) && value.localLayers.length <= 8, 'Invalid local layers');
        if (!value.localLayers.length) out.localLayers = [];
        else {
          const local = typeof module === 'object' && module.exports ? require('./local-adjustments.cjs') : globalThis.MintLocalAdjustments;
          check(local, 'Local adjustment validator is unavailable');
          out.localLayers = safeJson(local.validateLayers(value.localLayers, { sourceRevision }), ctx);
        }
      } else if (key === 'palette') { check(['natural','peach','rose'].includes(value.palette), 'Invalid portrait palette'); out.palette = value.palette; }
      else if (key === 'spots') {
        out.spots = array(value.spots, 64, 'spot edits').map(spot => {
          budget(ctx); object(spot, ['x', 'y', 'r'], 'spot');
          return { x: number(spot.x, 0, 1, 'spot x'), y: number(spot.y, 0, 1, 'spot y'), r: number(spot.r, 0.004, 0.06, 'spot radius') };
        });
      } else if (key === 'bgMode') { check(['original', 'blur', 'color', 'transparent'].includes(value[key]), 'Invalid background mode'); out[key] = value[key]; }
      else if (key === 'bgColor') { check(typeof value[key] === 'string' && /^#[0-9a-fA-F]{6}$/.test(value[key]), 'Invalid background color'); out[key] = value[key]; }
      else out[key] = number(value[key], ['smooth','brighten','slim','eyes','bgBlur','bgFeather','underEye','redness','lip','blush'].includes(key) ? 0 : -100, key === 'bgBlur' ? 50 : key === 'bgFeather' ? 20 : 100, key);
    }
    for (const key of ['learnedMatteId', 'diagnosticParseId']) if (Object.hasOwn(value, key)) out[key] = value[key] === null ? null : id(value[key], key);
    if (Object.hasOwn(value, 'diagnosticOverlay')) out.diagnosticOverlay = bool(value.diagnosticOverlay, 'diagnostic overlay');
    if (Object.hasOwn(value, 'diagnosticLayer')) { check(['skin','protected'].includes(value.diagnosticLayer), 'Invalid diagnostic layer'); out.diagnosticLayer = value.diagnosticLayer; }
    if (Object.hasOwn(value, 'learnedMatteStrokes')) {
      let work = 0;
      out.learnedMatteStrokes = array(value.learnedMatteStrokes, LIMITS.maxStrokes, 'matte strokes').map(stroke => {
        object(stroke, ['mode','points','radiusPx','hardness','opacity'], 'matte stroke'); budget(ctx);
        check(stroke.mode === 'keep' || stroke.mode === 'remove', 'Invalid matte stroke mode');
        const radiusPx = number(stroke.radiusPx, .5, Math.min(256, Math.max(1, Math.min(size.width, size.height) / 2)), 'matte stroke radius');
        const points = array(stroke.points, LIMITS.maxPointsPerStroke, 'stroke points').map(point => {
          object(point, ['x','y'], 'stroke point'); budget(ctx);
          return { x: number(point.x, 0, size.width, 'stroke x'), y: number(point.y, 0, size.height, 'stroke y') };
        });
        check(points.length > 0, 'Empty matte stroke');
        for (let n = 0; n < Math.max(1, points.length - 1); n++) {
          const a = points[n], b = points[Math.min(n + 1, points.length - 1)];
          const x0 = Math.max(0, Math.floor(Math.min(a.x,b.x) - radiusPx)), x1 = Math.min(size.width - 1, Math.ceil(Math.max(a.x,b.x) + radiusPx));
          const y0 = Math.max(0, Math.floor(Math.min(a.y,b.y) - radiusPx)), y1 = Math.min(size.height - 1, Math.ceil(Math.max(a.y,b.y) + radiusPx));
          work += (x1 - x0 + 1) * (y1 - y0 + 1); check(work <= LIMITS.maxBrushWork, 'Matte brush work limit exceeded');
        }
        return { mode: stroke.mode, points, radiusPx, hardness: number(stroke.hardness, 0, 1, 'brush hardness'), opacity: number(stroke.opacity, 0, 1, 'brush opacity') };
      });
    }
    if (Object.hasOwn(value, 'faceAdjustments') && value.faceAdjustments !== null) {
      const people = typeof module === 'object' && module.exports ? require('./portrait-people-desktop.cjs') : globalThis.MintPortraitPeopleDesktop;
      check(people, 'Per-person portrait validator is unavailable');
      try { out.faceAdjustments = safeJson(people.validate(value.faceAdjustments, {sourceRevision}), ctx); people.validateCompatibility(out, sourceRevision); }
      catch (error) { fail(`Invalid faceAdjustments: ${error.message}`); }
    }
    if (out.manualLiquify.length) { const replay = typeof module === 'object' && module.exports ? require('./manual-pipeline.cjs') : globalThis.MintManualPipeline; check(replay, 'Manual replay compatibility validator is unavailable'); replay.assertCompatible(out); }
    if (Object.hasOwn(value, 'paintLayers') && value.paintLayers !== null) {
      const paint = typeof module === 'object' && module.exports ? require('./paint-layers.cjs') : globalThis.MintPaintLayers;
      check(paint && typeof paint.validate === 'function', 'Paint layers validator is unavailable');
      try { out.paintLayers = safeJson(paint.validate(value.paintLayers, {sourceRevision, settings:out, sourceSize:size}), ctx); }
      catch (error) { fail(`Invalid paintLayers: ${error.message}`); }
    }
    if (Object.hasOwn(value, 'redactions') && value.redactions !== null) {
      const redaction = typeof module === 'object' && module.exports ? require('./redaction-layers.cjs') : globalThis.MintRedactionLayers;
      check(redaction && typeof redaction.validate === 'function', 'Redaction validator is unavailable');
      try { out.redactions = safeJson(redaction.validate(value.redactions, {sourceRevision, settings:out, sourceSize:size}), ctx); }
      catch (error) { fail(`Invalid redactions: ${error.message}`); }
    }
    return out;
  }
  function provenance(value, kind, sourceRevision, photoId, ctx) {
    object(value, ['jobId','task','modelId','modelVersion','weightsSha256','kind','device','executionProfile','selection','classVocabulary','maskClasses','maskPolicy'], 'model provenance');
    const out = safeJson(value, ctx);
    check(new TextEncoder().encode(JSON.stringify(out)).length <= LIMITS.maxProvenanceBytes, 'Model provenance limit exceeded');
    check(out.kind === 'model' && out.task === kind, 'Learned provenance kind/task mismatch');
    string(out.modelId, 160, 'model ID'); string(out.modelVersion, 160, 'model version'); hash(out.weightsSha256, 'weights SHA-256');
    object(out.device, ['kind','name'], 'model device'); check(['cpu','cuda','mps'].includes(out.device.kind), 'Invalid model device');
    if (Object.hasOwn(out.device, 'name')) string(out.device.name, 512, 'device name');
    if (Object.hasOwn(out, 'jobId')) string(out.jobId, 160, 'model job ID');
    if (kind === 'parse') {
      object(out.selection, ['kind','faceId','revision'], 'face selection');
      check(out.selection.kind === 'detected-face' && out.selection.revision === sourceRevision && typeof out.selection.faceId === 'string' && out.selection.faceId.startsWith(`${photoId}:face-`) && /^[0-9]+$/.test(out.selection.faceId.slice(photoId.length + 6)), 'Parsing selection/source mismatch');
      check(Array.isArray(out.classVocabulary) && out.classVocabulary.length === FACE_CLASSES.length && out.classVocabulary.every((v,i) => v === FACE_CLASSES[i]), 'Unexpected parsing class vocabulary');
      check(Array.isArray(out.maskClasses?.skin) && out.maskClasses.skin.length === 2 && out.maskClasses.skin[0] === 'skin' && out.maskClasses.skin[1] === 'nose', 'Parsing skin mask must include skin and nose');
      const policy = out.maskPolicy;
      check(policy?.version === 'segface-conservative-v1' && policy.kind === 'deterministic-mask-postprocessing-not-a-retouch-model' && policy.guard?.units === 'original-roi-pixels' && policy.guard.outsideRoi === 'fully-protected', 'Invalid conservative parsing policy');
      integer(policy.guard.radiusPx, 2, 12, 'parse guard radius');
    }
    return out;
  }
  function floatPlane(value, count, label) {
    check(value instanceof Float32Array, `Invalid ${label} Float32 plane`);
    checkBinaryObject(value, Float32Array.prototype, label);
    check(value.buffer instanceof ArrayBuffer && value.length === count, `Invalid ${label} Float32 plane`);
    for (const n of value) check(Number.isFinite(n) && n >= 0 && n <= 1, `Invalid ${label} probability`);
    return value;
  }
  function context() { return { nodes: 0, sourceBytes: 0, cacheBytes: 0, cacheEntries: 0, imageAssets: 0, imageAssetBytes: 0, metadataEstimate: 0 }; }
  function photoReview(value, ctx) {
    const review = typeof module === 'object' && module.exports ? require('./photo-review.cjs') : globalThis.MintPhotoReview;
    check(review && typeof review.validate === 'function', 'Photo review validator is unavailable');
    try { return safeJson(review.validate(value), ctx); }
    catch (error) { fail('Invalid photo review: ' + error.message); }
  }
  function neutralPhotoReview() { return { version: 1, current: { rating: 0, flag: 'none', label: 'none' }, undo: [], redo: [] }; }
  function normalizedSnapshot(snapshot, io) {
    const ctx = context();
    object(snapshot, ['version','currentId','photos'], 'project'); check([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, VERSION].includes(snapshot.version), 'Unsupported project version', 'UNSUPPORTED_VERSION');
    ctx.requireLevels = snapshot.version >= 7 && !!io.reading;
    // Version 8 writers and readers must carry explicit neutral/current recipes.
    // Only historical snapshots may supply the missing field via migration.
    ctx.requireCanvasPadding = snapshot.version >= 8;
    // Every v9 settings/history/export snapshot explicitly carries this field.
    ctx.requireTextLayers = snapshot.version >= 9;
    // Every v10 current/committed/history/export record explicitly carries the stage.
    ctx.requireLightBalance = snapshot.version >= 10;
    // Version 11 requires an explicit neutral/current final redaction stage.
    ctx.requireRedactions = snapshot.version >= 11;
    // Version 12 retains editable paint recipes in every history slot.
    ctx.requirePaintLayers = snapshot.version >= 12;
    ctx.requireFaceAdjustments = snapshot.version >= 13;
    // Version 14 owns the final straighten stage in every settings/history slot.
    ctx.requireStraighten = snapshot.version >= 14;
    ctx.requireSharpness = snapshot.version >= 15;
    ctx.requirePerspective = snapshot.version >= 17;
    ctx.legacyPerspective = snapshot.version < 17;
    ctx.requireImageLayers = snapshot.version >= 16;
    ctx.legacyImageAssets = snapshot.version < 16;
    const ids = new Set(), cacheIds = new Set();
    const photos = array(snapshot.photos, LIMITS.maxPhotos, 'photos').map(photo => {
      object(photo, ['id','name','sourceRevision','source','selected','settings','committed','undo','redo','revision','preset','imageAssets','learnedCache','latestMatteId','lastSelectedMatteId','exportedSettings', ...(snapshot.version >= 6 ? ['review'] : [])], 'photo');
      if (snapshot.version >= 6 && io.reading) check(Object.hasOwn(photo, 'review'), 'Missing photo review state');
      if (snapshot.version >= 16) check(Object.hasOwn(photo, 'imageAssets'), 'Missing photo image assets');
      const photoId = id(photo.id, 'photo ID'); check(!ids.has(photoId), 'Duplicate photo ID'); ids.add(photoId);
      const name = string(photo.name, 512, 'photo display name'), sourceRevision = id(photo.sourceRevision, 'source revision');
      object(photo.source, ['bytes','mime','width','height','byteLength','sha256'], 'source');
      const size = dimensions({ width: photo.source.width, height: photo.source.height });
      const source = io.source(photo.source, size, ctx);
      const out = { id: photoId, name, sourceRevision, source, selected: bool(photo.selected, 'photo selected'), settings: settings(photo.settings, size, ctx, sourceRevision), committed: settings(photo.committed, size, ctx, sourceRevision), undo: array(photo.undo, LIMITS.maxHistory, 'undo history').map(s => settings(s, size, ctx, sourceRevision)), redo: array(photo.redo, LIMITS.maxHistory, 'redo history').map(s => settings(s, size, ctx, sourceRevision)), revision: integer(photo.revision, 0, Number.MAX_SAFE_INTEGER, 'photo revision'), preset: photo.preset === null ? null : string(photo.preset, 80, 'preset ID'), learnedCache: [] };
      out.review = Object.hasOwn(photo, 'review') ? photoReview(photo.review, ctx) : neutralPhotoReview();
      if (Object.hasOwn(photo, 'exportedSettings')) out.exportedSettings = photo.exportedSettings === null ? null : settings(photo.exportedSettings, size, ctx, sourceRevision);
      const assetTable = Object.hasOwn(photo, 'imageAssets') ? photo.imageAssets : [];
      array(assetTable, LIMITS.maxPhotoImageAssets, 'image assets');
      check(!ctx.legacyImageAssets || !assetTable.length, 'Image assets require project version 16');
      const assetIds = new Set(); let photoAssetBytes = 0;
      out.imageAssets = assetTable.map(asset => {
        const fields = io.reading ? ['id','version','width','height','bytes','byteLength'] : ['id','version','width','height','data'];
        object(asset, fields, 'image asset');
        for (const key of fields) check(Object.hasOwn(asset, key), `Missing image asset field: ${key}`);
        check(typeof asset.id === 'string' && ASSET_ID_RE.test(asset.id), 'Invalid image asset ID');
        check(!assetIds.has(asset.id), 'Duplicate image asset ID'); assetIds.add(asset.id);
        check(asset.version === 1, 'Unsupported image asset version');
        const width = integer(asset.width, 1, LIMITS.maxImageAssetEdge, 'image asset width');
        const height = integer(asset.height, 1, LIMITS.maxImageAssetEdge, 'image asset height');
        check(width * height <= LIMITS.maxImageAssetPixels, 'Image asset pixel limit exceeded');
        const byteLength = width * height * 4;
        photoAssetBytes += byteLength; check(photoAssetBytes <= LIMITS.maxPhotoImageAssetBytes, 'Photo image asset byte limit exceeded');
        check(++ctx.imageAssets <= LIMITS.maxImageAssets, 'Project image asset count limit exceeded');
        ctx.imageAssetBytes += byteLength; check(ctx.imageAssetBytes <= LIMITS.maxImageAssetBytesTotal, 'Project image asset byte limit exceeded');
        ctx.cacheBytes += byteLength; check(ctx.cacheBytes <= LIMITS.maxCacheBytes, 'Combined learned cache and image asset byte limit exceeded');
        budget(ctx, fields.length + 1);
        return io.asset(asset, { width, height, byteLength });
      });
      const entries = new Map();
      for (const entry of array(photo.learnedCache, LIMITS.maxCacheEntries, 'learned cache')) {
        check(++ctx.cacheEntries <= LIMITS.maxCacheEntries, 'Learned cache entry limit exceeded');
        object(entry, ['id','kind','photoId','sourceRevision','originalSize','result','bytes'], 'learned cache entry');
        const entryId = id(entry.id, 'cache ID'); check(!cacheIds.has(entryId), 'Duplicate learned cache ID'); cacheIds.add(entryId);
        check(entry.photoId === photoId && entry.sourceRevision === sourceRevision, 'Learned result belongs to another source revision');
        check(entry.kind === 'matting' || entry.kind === 'parse', 'Unsupported learned result kind');
        const originalSize = dimensions(entry.originalSize, true);
        check(originalSize.width === size.width && originalSize.height === size.height, 'Learned result dimensions differ from source');
        object(entry.result, entry.kind === 'matting' ? ['kind','matte','provenance'] : ['kind','width','height','roi','skin','protected','provenance'], 'learned result');
        const p = provenance(entry.result.provenance, entry.kind, sourceRevision, photoId, ctx);
        let result, expectedBytes;
        if (entry.kind === 'matting') {
          if (Object.hasOwn(entry.result, 'kind')) check(entry.result.kind === 'matting', 'Invalid matting result kind');
          const m = entry.result.matte; object(m, ['width','height','roi','space','encoding','data'], 'learned matte');
          const roi = region(m.roi, size);
          check(roi.x === 0 && roi.y === 0 && roi.width === size.width && roi.height === size.height && m.width === size.width && m.height === size.height && m.space === 'roi-original-pixels' && m.encoding === 'unit-float32', 'Matte must use exact original full-image pixels');
          expectedBytes = size.width * size.height * 4;
          ctx.cacheBytes += expectedBytes; check(ctx.cacheBytes <= LIMITS.maxCacheBytes, 'Learned cache byte limit exceeded');
          result = { ...(Object.hasOwn(entry.result, 'kind') ? { kind: 'matting' } : {}), matte: { width: m.width, height: m.height, roi, space: m.space, encoding: m.encoding, data: io.plane(m.data, size.width * size.height) }, provenance: p };
        } else {
          const r = entry.result, roi = region(r.roi, size), count = roi.width * roi.height;
          check(count <= LIMITS.maxParsePixels && r.kind === 'face-masks' && r.width === roi.width && r.height === roi.height, 'Invalid original-pixel face parsing geometry');
          expectedBytes = count * 8;
          ctx.cacheBytes += expectedBytes; check(ctx.cacheBytes <= LIMITS.maxCacheBytes, 'Learned cache byte limit exceeded');
          const skin = io.plane(r.skin, count), protectedPlane = io.plane(r.protected, count);
          io.complement(skin, protectedPlane, count);
          result = { kind: 'face-masks', width: r.width, height: r.height, roi, skin, protected: protectedPlane, provenance: p };
        }
        check(entry.bytes === expectedBytes, 'Learned cache byte count mismatch');
        const saved = { id: entryId, kind: entry.kind, photoId, sourceRevision, originalSize, result, bytes: expectedBytes };
        entries.set(entryId, saved); out.learnedCache.push(saved);
      }
      for (const s of [out.settings, out.committed, ...out.undo, ...out.redo, ...(out.exportedSettings ? [out.exportedSettings] : [])]) {
        for (const layer of s.imageLayers) check(assetIds.has(layer.assetId), 'Missing or foreign image asset referenced by settings/history');
        if (s.learnedMatteId) check(entries.get(s.learnedMatteId)?.kind === 'matting', 'Missing learned matte referenced by settings/history');
        if (s.diagnosticParseId) check(entries.get(s.diagnosticParseId)?.kind === 'parse', 'Missing parsing result referenced by settings/history');
        check(!s.diagnosticOverlay || !!s.diagnosticParseId, 'Diagnostic overlay has no parsing result');
        if (s.learnedMatteStrokes?.length) {
          check(s.learnedMatteId || out.learnedCache.some(e => e.kind === 'matting'), 'Brush corrections have no original learned result');
        }
      }
      for (const key of ['latestMatteId','lastSelectedMatteId']) if (Object.hasOwn(photo, key)) {
        out[key] = photo[key] === null ? null : id(photo[key], key);
        check(out[key] === null || entries.get(out[key])?.kind === 'matting', 'Missing last selected learned matte');
      }
      // Account per-photo metadata before accumulating a potentially huge history.
      ctx.metadataEstimate += io.estimate(out); check(ctx.metadataEstimate <= LIMITS.maxMetadataBytes, 'Project metadata byte limit exceeded');
      return out;
    });
    const currentId = snapshot.currentId === null ? null : id(snapshot.currentId, 'current photo ID');
    check(currentId === null || ids.has(currentId), 'Current photo does not exist');
    return { version: VERSION, currentId, photos };
  }
  function rawFloatBytes(value) {
    if (HOST_LITTLE_ENDIAN) return new Uint8Array(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    const bytes = new Uint8Array(value.length * 4), view = new DataView(bytes.buffer);
    for (let i = 0; i < value.length; i++) view.setFloat32(i * 4, value[i], true);
    return bytes;
  }
  function readFloatBytes(bytes, count) {
    check(bytes.length === count * 4, 'Float32 byte length mismatch');
    if (HOST_LITTLE_ENDIAN && bytes.byteOffset % 4 === 0) return floatPlane(new Float32Array(bytes.buffer, bytes.byteOffset, count), count, 'learned');
    const out = new Float32Array(count), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < count; i++) out[i] = view.getFloat32(i * 4, true);
    return floatPlane(out, count, 'learned');
  }
  function complement(a, b, count) { for (let i = 0; i < count; i++) check(Math.abs(a[i] + b[i] - 1) <= 1e-6, 'Parsing planes are not complementary'); }
  function jsonSize(value) { return new TextEncoder().encode(JSON.stringify(value)).length; }
  function checkJsonComplexity(value, ctx = context(), depth = 0) {
    budget(ctx); check(depth <= 14, 'Project metadata nesting limit exceeded');
    if (value && typeof value === 'object') for (const child of Object.values(value)) checkJsonComplexity(child, ctx, depth + 1);
  }
  function imageAssetCodec(options) {
    const assets = typeof module === 'object' && module.exports ? require('./image-assets.cjs') : globalThis.MintImageAssets;
    const overlay = typeof module === 'object' && module.exports ? require('./image-overlay.cjs') : globalThis.MintImageOverlay;
    check(assets && typeof assets.createCodec === 'function' && overlay, 'Image asset codec is unavailable');
    return assets.createCodec({ overlay, digest: bytes => sha256(bytes, options) });
  }
  /** Copies snapshot bytes synchronously before hashing, preventing caller mutation during awaits. */
  async function encodeParts(snapshot, options = {}) {
    const blobs = [], raw = [], originalHashes = [], assetHashes = [], floatValues = new Map();
    let codec;
    const add = (kind, bytes) => { check(blobs.length < MAX_BLOBS, 'Project blob count limit exceeded'); const blobId = `blob-${blobs.length}`; raw.push(bytes); blobs.push({ id: blobId, kind, offset: 0, byteLength: bytes.length, sha256: '' }); return blobId; };
    const metadata = normalizedSnapshot(snapshot, {
      source(source, size, ctx) {
        const view = byteView(source.bytes, 'source bytes'); integer(view.length, 1, LIMITS.maxPhotoBytes, 'source byte size');
        ctx.sourceBytes += view.length; check(ctx.sourceBytes <= LIMITS.maxSourceBytes, 'Source byte limit exceeded');
        if (Object.hasOwn(source, 'byteLength')) check(source.byteLength === view.length, 'Original byte size mismatch');
        if (Object.hasOwn(source, 'sha256')) hash(source.sha256, 'source identity hash');
        const bytes = new Uint8Array(view), image = inspectImage(bytes, source.mime);
        check(size.width === image.width && size.height === image.height, 'Source dimensions do not match oriented image header');
        const bytesId = add('original', bytes); originalHashes.push({ bytesId, expected: source.sha256 });
        return { bytes: bytesId, mime: source.mime, width: size.width, height: size.height, byteLength: bytes.length, sha256: '' };
      },
      asset(asset, size) {
        codec ||= imageAssetCodec(options);
        let image;
        try { image = codec.toRaw(asset); } catch (error) { fail(`Invalid image asset: ${error.message}`); }
        // toRaw owns fresh decoded storage; retain only its raw bytes and small descriptor.
        const bytes = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
        const bytesId = add('rgba8', bytes);
        assetHashes.push({ id: asset.id, width: size.width, height: size.height, data: bytes });
        return { id: asset.id, version: 1, width: size.width, height: size.height, bytes: bytesId, byteLength: size.byteLength };
      },
      plane(value, count) { floatPlane(value, count, 'learned'); const bytes = rawFloatBytes(value), blobId = add('float32le', bytes); floatValues.set(blobId, bytes); return blobId; },
      complement(a, b, count) {
        const av = new DataView(floatValues.get(a).buffer), bv = new DataView(floatValues.get(b).buffer);
        for (let i = 0; i < count; i++) check(Math.abs(av.getFloat32(i * 4, true) + bv.getFloat32(i * 4, true) - 1) <= 1e-6, 'Parsing planes are not complementary');
      },
      estimate: jsonSize
    });
    let payloadBytes = 0;
    for (let i = 0; i < blobs.length; i++) { const b = blobs[i]; b.offset = payloadBytes; payloadBytes += b.byteLength; b.sha256 = await sha256(raw[i], options); }
    for (const asset of assetHashes) {
      const identity = codec.identityBytes({ width: asset.width, height: asset.height, data: asset.data });
      check('rgba-' + await sha256(identity, options) === asset.id, 'Image asset identity SHA-256 mismatch');
    }
    for (let i = 0; i < metadata.photos.length; i++) {
      const record = originalHashes[i], digest = blobs[Number(record.bytesId.slice(5))].sha256;
      check(!record.expected || record.expected === digest, 'Source SHA-256 identity mismatch'); metadata.photos[i].source.sha256 = digest;
    }
    const document = { format: 'mint-portrait-project', ...metadata, blobs };
    checkJsonComplexity(document);
    const json = new TextEncoder().encode(JSON.stringify(document));
    check(json.length <= LIMITS.maxMetadataBytes, 'Project metadata byte limit exceeded');
    const total = HEADER_BYTES + json.length + payloadBytes; check(total <= LIMITS.maxContainerBytes, 'Project container byte limit exceeded');
    const header = new Uint8Array(HEADER_BYTES), h = new DataView(header.buffer); header.set(MAGIC);
    h.setUint32(8, VERSION, true); h.setUint32(12, HEADER_BYTES, true); h.setUint32(16, json.length, true);
    h.setUint32(20, payloadBytes, true); h.setUint32(24, total, true); h.setUint32(28, blobs.length, true);
    header.set(hexToBytes(await sha256(json, options)), 32);
    return { parts: [header, json, ...raw], byteLength: total };
  }
  async function encode(snapshot, options = {}) {
    const result = await encodeParts(snapshot, options), out = new Uint8Array(result.byteLength); let offset = 0;
    for (const part of result.parts) { out.set(part, offset); offset += part.length; }
    return out;
  }
  function inspectHeader(value) {
    const bytes = byteView(value, 'project header'); check(bytes.length >= HEADER_BYTES, 'Truncated project header');
    check(MAGIC.every((n,i) => bytes[i] === n), 'Not a Mint Portrait project');
    const h = new DataView(bytes.buffer, bytes.byteOffset, HEADER_BYTES);
    check([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, VERSION].includes(h.getUint32(8, true)), 'Unsupported project version', 'UNSUPPORTED_VERSION');
    check(h.getUint32(12, true) === HEADER_BYTES, 'Invalid project header length');
    const metadataBytes = integer(h.getUint32(16, true), 1, LIMITS.maxMetadataBytes, 'metadata byte length');
    const payloadBytes = integer(h.getUint32(20, true), 0, LIMITS.maxSourceBytes + LIMITS.maxCacheBytes, 'payload byte length');
    const byteLength = integer(h.getUint32(24, true), HEADER_BYTES + 1, LIMITS.maxContainerBytes, 'container byte length');
    check(byteLength === HEADER_BYTES + metadataBytes + payloadBytes, 'Project framing length mismatch');
    const blobCount = integer(h.getUint32(28, true), 0, MAX_BLOBS, 'blob count');
    return { version: h.getUint32(8, true), headerBytes: HEADER_BYTES, metadataBytes, payloadBytes, byteLength, blobCount, metadataSha256: bytesToHex(bytes.subarray(32, 64)) };
  }
  /** Validate everything before returning. Restored originals/planes do not alias file bytes. */
  async function decode(value, options = {}) {
    const bytes = byteView(value, 'project file'); check(bytes.length <= LIMITS.maxContainerBytes, 'Project container byte limit exceeded');
    const header = inspectHeader(bytes); check(bytes.length === header.byteLength, 'Truncated project or unexpected trailing data');
    const json = new Uint8Array(bytes.subarray(HEADER_BYTES, HEADER_BYTES + header.metadataBytes));
    let snapshot, preparationError; const pendingHashes = [];
    try {
      let parsed, jsonText;
      try { jsonText = new TextDecoder('utf-8', { fatal: true }).decode(json); parsed = JSON.parse(jsonText); } catch { fail('Invalid UTF-8 JSON project metadata'); }
      // Our writer emits compact JSON. Requiring the same form also rejects duplicate
      // keys, alternate number spellings, hidden whitespace, and ambiguous readers.
      checkJsonComplexity(parsed);
      check(JSON.stringify(parsed) === jsonText, 'Noncanonical or duplicate-key project metadata');
      const doc = safeJson(parsed, context());
      object(doc, ['format','version','currentId','photos','blobs'], 'document'); check(doc.format === 'mint-portrait-project', 'Unknown project format'); check(doc.version === header.version, 'Project header/document version mismatch');
      const records = array(doc.blobs, MAX_BLOBS, 'blob directory'); check(records.length === header.blobCount, 'Blob count mismatch');
      const directory = new Map(); let offset = 0, originalTotal = 0, cacheTotal = 0, assetTotal = 0, assetCount = 0;
      for (let i = 0; i < records.length; i++) {
        const b = records[i]; object(b, ['id','kind','offset','byteLength','sha256'], 'blob descriptor');
        check(b.id === `blob-${i}` && b.offset === offset, 'Invalid, overlapping, or unordered blob directory');
        check(b.kind === 'original' || b.kind === 'float32le' || (header.version >= 16 && b.kind === 'rgba8'), 'Unknown blob encoding');
        integer(b.byteLength, 1, b.kind === 'original' ? LIMITS.maxPhotoBytes : b.kind === 'rgba8' ? LIMITS.maxImageAssetBytes : LIMITS.maxLearnedPixels * 4, 'blob byte size'); hash(b.sha256, 'blob hash');
        if (b.kind === 'original') { originalTotal += b.byteLength; check(originalTotal <= LIMITS.maxSourceBytes, 'Source byte limit exceeded'); }
        else {
          check(b.byteLength % 4 === 0, 'Invalid Float32/RGBA blob byte size');
          cacheTotal += b.byteLength; check(cacheTotal <= LIMITS.maxCacheBytes, 'Combined learned cache and image asset byte limit exceeded');
          if (b.kind === 'rgba8') {
            check(++assetCount <= LIMITS.maxImageAssets, 'Project image asset count limit exceeded');
            assetTotal += b.byteLength; check(assetTotal <= LIMITS.maxImageAssetBytesTotal, 'Project image asset byte limit exceeded');
          }
        }
        offset += b.byteLength; check(offset <= header.payloadBytes, 'Blob extends beyond payload'); directory.set(b.id, b);
      }
      check(offset === header.payloadBytes, 'Unreferenced payload bytes');
      const used = new Set();
      function take(blobId, kind) {
        const b = directory.get(blobId); check(b && b.kind === kind && !used.has(blobId), 'Missing, duplicate, or wrong-kind blob reference'); used.add(blobId);
        // Own a stable snapshot before any await. Never retain views into mutable input.
        const start = HEADER_BYTES + header.metadataBytes + b.offset, owned = new Uint8Array(bytes.subarray(start, start + b.byteLength));
        pendingHashes.push({ bytes: owned, digest: b.sha256 }); return { bytes: owned, record: b };
      }
      snapshot = normalizedSnapshot({ version: doc.version, currentId: doc.currentId, photos: doc.photos }, {
        reading: true,
        source(source, size, ctx) {
          const { bytes: owned, record } = take(source.bytes, 'original');
          check(source.byteLength === owned.length && source.sha256 === record.sha256, 'Source identity/byte-size mismatch');
          ctx.sourceBytes += owned.length; check(ctx.sourceBytes <= LIMITS.maxSourceBytes, 'Source byte limit exceeded');
          const image = inspectImage(owned, source.mime); check(image.width === size.width && image.height === size.height, 'Source dimensions do not match oriented image header');
          return { bytes: owned, mime: source.mime, width: size.width, height: size.height, byteLength: owned.length, sha256: source.sha256 };
        },
        asset(asset, size) {
          check(asset.byteLength === size.byteLength, 'Image asset descriptor byte length mismatch');
          const record = directory.get(asset.bytes);
          check(record && record.byteLength === size.byteLength, 'Image asset blob byte length mismatch');
          const { bytes: owned } = take(asset.bytes, 'rgba8');
          // A private raw placeholder, never returned to a caller or encoded as metadata.
          return { id: asset.id, width: size.width, height: size.height, data: owned };
        },
        plane(blobId, count) { return readFloatBytes(take(blobId, 'float32le').bytes, count); },
        complement,
        estimate(out) {
          // Metadata size has already been checked; do not JSON-stringify typed pixel arrays.
          return 0;
        }
      });
      check(used.size === directory.size, 'Unreferenced blobs are not allowed');
    } catch (error) { preparationError = error; }
    // Parsing, budget/reference validation and all input-byte copies happen before
    // the first await, including the metadata hash. Caller mutations cannot race a load.
    check(await sha256(json, options) === header.metadataSha256, 'Project metadata SHA-256 mismatch');
    if (preparationError) throw preparationError;
    for (const pending of pendingHashes) check(await sha256(pending.bytes, options) === pending.digest, 'Project blob SHA-256 mismatch');
    let codec;
    for (const photo of snapshot.photos) for (let i = 0; i < photo.imageAssets.length; i++) {
      codec ||= imageAssetCodec(options);
      // Reconstruct base64 only after every schema, count, byte budget, blob and
      // reference is validated. fromRaw also checks dimension-bound content identity.
      try { photo.imageAssets[i] = await codec.fromRaw(photo.imageAssets[i]); }
      catch (error) { fail(`Invalid image asset identity: ${error.message}`); }
    }
    return snapshot;
  }
  return Object.freeze({ VERSION, HEADER_BYTES, LIMITS, MAX_CONTAINER_BYTES: LIMITS.maxContainerBytes, DEFAULT_SETTINGS, ProjectFormatError, inspectImage, inspectHeader, encodeParts, encode, decode, validateSettings: (value, size, revision) => settings(value, dimensions(size), context(), id(revision, 'source revision')) });
});
