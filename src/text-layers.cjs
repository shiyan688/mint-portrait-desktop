/* Desktop editable text collection and straight-sRGB source-over compositor.
 * Font layout belongs exclusively to the frozen MintTextOverlay Canvas core.
 * Text is final-canvas relative and never rewrites the source image or recipes. */
(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? require('./text-overlay.cjs') : root.MintTextOverlay);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MintTextLayers = api;
})(typeof globalThis === 'object' ? globalThis : this, function (Text) {
  'use strict';
  const LIMITS = Object.freeze({ maxLayers: 8, maxTextCodePoints: 4000, maxPixels: 16000000, maxEdge: 16384 });
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  function check(ok, message) { if (!ok) { const e = new TypeError(message); e.code = 'TEXT_LAYERS_INVALID'; throw e; } }
  function record(value, fields, label) {
    check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Invalid ' + label);
    const proto = Object.getPrototypeOf(value);
    check(proto === Object.prototype || proto === null, 'Invalid ' + label + ' prototype');
    const keys = Reflect.ownKeys(value), out = Object.create(null);
    check(keys.length === fields.length, 'Missing or unexpected ' + label + ' fields');
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      check(typeof key === 'string' && fields.includes(key) && d && d.enumerable && own(d, 'value'), 'Unsafe ' + label + ' field');
      out[key] = d.value;
    }
    for (const key of fields) check(own(out, key), 'Missing ' + label + ' field: ' + key);
    return out;
  }
  function validate(value) {
    check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, 'Text layers must be an ordinary array');
    const length = Object.getOwnPropertyDescriptor(value, 'length').value;
    check(length <= LIMITS.maxLayers, 'Text layer count exceeds 8');
    const keys = Reflect.ownKeys(value);
    check(keys.length === length + 1, 'Sparse or extended text layers are not allowed');
    const entries = [];
    for (const key of keys) {
      if (key === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(value, key);
      check(typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length && d.enumerable && own(d, 'value'), 'Unsafe text layer index');
      entries[Number(key)] = d.value;
    }
    const ids = new Set(); let codePoints = 0;
    return Object.freeze(entries.map(value => {
      const layer = record(value, ['id','enabled','recipe'], 'text layer');
      check(typeof layer.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(layer.id) && !['constructor','prototype','__proto__'].includes(layer.id), 'Invalid text layer ID');
      check(!ids.has(layer.id), 'Duplicate text layer ID'); ids.add(layer.id);
      check(typeof layer.enabled === 'boolean', 'Text layer enabled must be boolean');
      check(Text && typeof Text.validate === 'function', 'Shared text recipe validator is unavailable');
      const recipe = Text.validate(layer.recipe);
      codePoints += Array.from(recipe.text).length;
      check(codePoints <= LIMITS.maxTextCodePoints, 'Total text length exceeds budget');
      return Object.freeze({ id: layer.id, enabled: layer.enabled, recipe: Object.freeze(recipe) });
    }));
  }
  function isActive(value) { return validate(value).some(layer => layer.enabled && Text.isActive(layer.recipe)); }
  function canonicalRecipe(value) { return JSON.stringify(validate(value)); }
  function dimensions(width, height) {
    check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width <= LIMITS.maxEdge && height <= LIMITS.maxEdge && width * height <= LIMITS.maxPixels, 'Text final canvas exceeds 1600 万 pixels / 16384 edge budget');
  }
  // Do not read shadowable metadata or invoke custom typed-array iteration.
  const typed = Object.getPrototypeOf(Uint8Array.prototype);
  const bufferOf = Object.getOwnPropertyDescriptor(typed, 'buffer').get;
  const lengthOf = Object.getOwnPropertyDescriptor(typed, 'length').get;
  const byteOffsetOf = Object.getOwnPropertyDescriptor(typed, 'byteOffset').get;
  const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  const bufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
  function pixels(value, length, label, clamped) {
    check(value && (Object.getPrototypeOf(value) === Uint8Array.prototype || (clamped && Object.getPrototypeOf(value) === Uint8ClampedArray.prototype)), label + ' must be ordinary RGBA bytes');
    for (const key of ['buffer','byteOffset','byteLength','length']) check(!own(value, key), 'Unsafe ' + label + ' property');
    check(Object.getOwnPropertySymbols(value).length === 0, 'Unsafe ' + label + ' symbol');
    const buffer = bufferOf.call(value);
    check(buffer instanceof ArrayBuffer && Object.getPrototypeOf(buffer) === ArrayBuffer.prototype, 'Shared or custom ' + label + ' buffer is not allowed');
    check(lengthOf.call(value) === length, label + ' RGBA length mismatch');
    check((!bufferResizable || !bufferResizable.call(buffer)) && bufferLength.call(buffer) <= LIMITS.maxPixels * 4, label + ' backing storage must be fixed and bounded');
    return new Uint8Array(buffer, byteOffsetOf.call(value), length);
  }
  function composite(image, overlay, options) {
    const source = record(image, ['width','height','data'], 'source raster');
    const layer = record(overlay, ['width','height','rgba'], 'text raster');
    dimensions(source.width, source.height); dimensions(layer.width, layer.height);
    check(source.width === layer.width && source.height === layer.height, 'Text raster dimensions mismatch');
    let shouldCancel = null;
    if (options !== undefined) {
      check(options !== null && typeof options === 'object' && !Array.isArray(options), 'Invalid text compositing options');
      const keys = Reflect.ownKeys(options);
      check(keys.length <= 1 && (!keys.length || keys[0] === 'shouldCancel'), 'Invalid text compositing options');
      const value = record(options, keys, 'text compositing options');
      if (own(value, 'shouldCancel')) { check(typeof value.shouldCancel === 'function', 'Invalid text cancellation callback'); shouldCancel = value.shouldCancel; }
    }
    const cancelled = () => { if (shouldCancel && shouldCancel()) { const e = new Error('Text compositing cancelled'); e.name = 'AbortError'; throw e; } };
    const length = source.width * source.height * 4;
    const src = pixels(source.data, length, 'source', true), top = pixels(layer.rgba, length, 'text overlay', false);
    cancelled();
    const out = new Uint8ClampedArray(src);
    for (let y = 0; y < source.height; y++) {
      cancelled();
      for (let i = y * source.width * 4, end = i + source.width * 4; i < end; i += 4) {
        const a = top[i + 3];
        if (a === 0) continue; // Preserve source bytes, including hidden RGB, exactly.
        const b = src[i + 3], back = b * (255 - a), alpha = a * 255 + back;
        for (let c = 0; c < 3; c++) out[i + c] = Math.round((top[i + c] * a * 255 + src[i + c] * back) / alpha);
        out[i + 3] = Math.round(alpha / 255);
      }
    }
    cancelled();
    return { width: source.width, height: source.height, data: out };
  }
  return Object.freeze({ LIMITS, validate, isActive, composite, canonicalRecipe });
});
