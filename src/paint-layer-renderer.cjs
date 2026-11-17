/* Renderer-owned, bounded Canvas paint raster orchestration. No font loading,
 * network, image decoding, file paths, or native-export authority is provided.
 * The recipe hash binds an association, not proof that pixels match a recipe.
 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MintPaintLayerRenderer = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  'use strict';
  const LIMITS = Object.freeze({ pixels: 16000000, edge: 16384, rgbaBytes: 64000000, sourceBytes: 80 * 1024 * 1024 });
  const typed = Object.getPrototypeOf(Uint8Array.prototype);
  const gets = Object.fromEntries(['length', 'byteLength', 'byteOffset', 'buffer'].map(k => [k, Object.getOwnPropertyDescriptor(typed, k).get]));
  const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable');
  const setBytes = typed.set;
  const issued = new WeakSet();
  const compositor = typeof module === 'object' && module.exports ? require('./text-layers.cjs') : root.MintTextLayers;
  const has = (v, key) => Object.prototype.hasOwnProperty.call(v, key);
  function check(ok, message) {
    if (!ok) { const error = new TypeError(message); error.code = 'PAINT_RENDERER_INVALID'; throw error; }
  }
  function record(value, allowed, required, label) {
    check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Invalid ' + label);
    const proto = Object.getPrototypeOf(value);
    check(proto === Object.prototype || proto === null, 'Invalid ' + label + ' prototype');
    const out = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      check(typeof key === 'string' && allowed.includes(key) && descriptor && descriptor.enumerable && has(descriptor, 'value'), 'Invalid ' + label + ' field');
      out[key] = descriptor.value;
    }
    for (const key of required) check(has(out, key), 'Missing ' + label + ' field: ' + key);
    return out;
  }
  function dimensions(width, height) {
    check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 &&
      width <= LIMITS.edge && height <= LIMITS.edge && width * height <= LIMITS.pixels,
    'Paint raster dimensions exceed 16,000,000 pixels or 16,384 pixels per edge');
    return width * height * 4;
  }
  // Intrinsics bypass shadowed getters and reject proxies, detached/shared or
  // resizable storage. Bound the real backing allocation, not claimed length.
  function bytes(value, maximum, expected, allowBuffer) {
    check(value && typeof value === 'object', 'Expected fixed native byte storage');
    const proto = Object.getPrototypeOf(value);
    let buffer, offset, length;
    if (allowBuffer && proto === ArrayBuffer.prototype) {
      buffer = value; offset = 0; length = bufferLength.call(buffer);
    } else {
      check(proto === Uint8Array.prototype || proto === Uint8ClampedArray.prototype, 'Expected native Uint8Array or Uint8ClampedArray');
      buffer = gets.buffer.call(value); offset = gets.byteOffset.call(value); length = gets.byteLength.call(value);
      check(gets.length.call(value) === length, 'Invalid byte array length');
    }
    check(Object.getPrototypeOf(buffer) === ArrayBuffer.prototype, 'Shared or custom byte storage is unsupported');
    const backing = bufferLength.call(buffer);
    check(!resizable || !resizable.get.call(buffer), 'Resizable byte storage is unsupported');
    check(backing <= maximum && length <= maximum && offset + length <= backing &&
      (expected === undefined || expected === length), 'Invalid or oversized byte storage');
    // Constructing a view also rejects detached zero-length ArrayBuffers.
    return new Uint8Array(buffer, offset, length);
  }
  function copyBytes(value, maximum, expected, allowBuffer) {
    const view = bytes(value, maximum, expected, allowBuffer), out = new Uint8Array(gets.length.call(view));
    setBytes.call(out, view); return out;
  }
  function controls(input) {
    if (has(input, 'isCurrent') && input.isCurrent !== undefined) check(typeof input.isCurrent === 'function', 'isCurrent must be a function');
    if (has(input, 'signal') && input.signal != null) check(typeof input.signal === 'object' &&
      typeof input.signal.aborted === 'boolean' && typeof input.signal.addEventListener === 'function' &&
      typeof input.signal.removeEventListener === 'function', 'Invalid cancellation signal');
    return { signal: input.signal || null, isCurrent: input.isCurrent || null };
  }
  function assertCurrent(opt) {
    const aborted = (opt.signal && opt.signal.aborted) || (opt.shouldCancel && opt.shouldCancel());
    const stale = !aborted && opt.isCurrent && !opt.isCurrent();
    if (aborted || stale) {
      const error = new Error(aborted ? 'Paint rendering cancelled' : 'Paint rendering superseded');
      error.name = 'AbortError'; error.code = stale ? 'PAINT_RENDERER_STALE' : 'PAINT_RENDERER_ABORTED'; throw error;
    }
  }
  // A never-settling digest cannot retain an operation indefinitely
  // after cancellation. A small stale poll is needed when no AbortSignal exists.
  function waitCurrent(promise, opt) {
    return new Promise((resolve, reject) => {
      let finished = false, timer = null;
      function finish(error, value) {
        if (finished) return;
        finished = true;
        if (timer !== null) clearTimeout(timer);
        if (opt.signal) opt.signal.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve(value);
      }
      function verify() {
        try { assertCurrent(opt); return true; } catch (error) { finish(error); return false; }
      }
      function onAbort() { verify(); }
      function poll() { if (!finished && verify()) timer = setTimeout(poll, 25); }
      // Both handlers remain installed after cancellation, consuming a late
      // rejection instead of producing an unhandled rejected digest promise.
      // Attach them BEFORE the first check: a host getter/digest may itself
      // cancel the operation while returning a rejected promise.
      Promise.resolve(promise).then(value => { if (!finished && verify()) finish(null, value); }, error => finish(error));
      if (opt.signal) opt.signal.addEventListener('abort', onAbort, { once: true });
      if (!verify()) return;
      if (opt.isCurrent || opt.shouldCancel) timer = setTimeout(poll, 25);
    });
  }
  function dispose(canvas) {
    if (!canvas) return;
    try { canvas.width = 0; } catch (_) { /* Best effort for a failed host. */ }
    try { canvas.height = 0; } catch (_) { /* Never mask the original failure. */ }
    try { if (canvas.width !== 0) canvas.width = 1; } catch (_) {}
    try { if (canvas.height !== 0) canvas.height = 1; } catch (_) {}
  }
  function create(dependencies) {
    const dep = dependencies || {}, document = dep.document || root.document, crypto = dep.crypto || root.crypto;
    const layersCore = dep.layersCore || root.MintPaintLayers;
    check(document && typeof document.createElement === 'function', 'A local document is required');
    check(layersCore && ['validate', 'geometryKey', 'isActive', 'canonicalRecipe', 'plan', 'render'].every(k => typeof layersCore[k] === 'function'), 'Paint layers core is unavailable');
    function makeCanvas(width, height) {
      dimensions(width, height);
      const canvas = document.createElement('canvas');
      check(canvas && (typeof canvas === 'object' || typeof canvas === 'function'), 'Canvas factory returned no surface');
      // Reject before changing dimensions: a host may return a borrowed input,
      // a previously returned preview, or a surface already issued elsewhere.
      check(!issued.has(canvas), 'Canvas factory must return a fresh, unshared surface');
      issued.add(canvas);
      try {
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb', willReadFrequently: true });
        check(ctx, 'Canvas 2D is unavailable'); return { canvas, ctx };
      } catch (error) { dispose(canvas); throw error; }
    }
    function snapshotContext(value) {
      const c = record(value, ['sourceRevision', 'settings', 'sourceSize', 'shouldCancel'],
        ['sourceRevision', 'settings', 'sourceSize'], 'paint context');
      if (has(c, 'shouldCancel')) check(typeof c.shouldCancel === 'function', 'shouldCancel must be a function');
      const ss = record(c.sourceSize, ['width', 'height'], ['width', 'height'], 'source size');
      // Canonical geometry excludes color-only settings while preserving all
      // geometry/warp data. No mutable caller object survives an await.
      const settings = JSON.parse(layersCore.geometryKey(c.settings));
      return { sourceRevision: c.sourceRevision, settings, sourceSize: { width: ss.width, height: ss.height },
        ...(has(c, 'shouldCancel') ? { shouldCancel: c.shouldCancel } : {}) };
    }
    function readPixels(ctx, width, height) {
      const image = ctx.getImageData(0, 0, width, height);
      check(image && image.width === width && image.height === height, 'Canvas returned mismatched pixel dimensions');
      return copyBytes(image.data, LIMITS.rgbaBytes, dimensions(width, height), false);
    }
    function putPixels(ctx, width, height, value) {
      const view = bytes(value, LIMITS.rgbaBytes, dimensions(width, height), false);
      const image = ctx.createImageData(width, height);
      check(image && image.width === width && image.height === height, 'Canvas returned mismatched image dimensions');
      const target = bytes(image.data, LIMITS.rgbaBytes, dimensions(width, height), false);
      setBytes.call(target, view); ctx.putImageData(image, 0, 0);
    }
    async function renderValidated(layers, context, width, height, opt) {
      assertCurrent(opt);
      // Aggregate budgets are checked before the first pixel buffer or Canvas.
      if (!layersCore.plan(width, height, layers, context).active) return null;
      check(compositor && typeof compositor.composite === 'function', 'Straight-sRGB compositor is unavailable');
      let result = null;
      for (const layer of layers.layers) {
        const single = { version: 1, sourceRevision: layers.sourceRevision, geometryKey: layers.geometryKey, layers: [layer] };
        if (!layersCore.isActive(single)) continue;
        // Native Canvas allocations can be released on the next event-loop
        // turn, not merely when resized. Yield between every owned layer.
        await waitCurrent(new Promise(resolve => setTimeout(resolve, 0)), opt);
        assertCurrent(opt);
        const owned = []; let next;
        try {
          let painted = layersCore.render(width, height, single, context, {
            createCanvas: (w, h) => { const surface = makeCanvas(w, h).canvas; owned.push(surface); return surface; },
            shouldCancel: () => { assertCurrent(opt); return false; }
          });
          assertCurrent(opt);
          check(painted !== null, 'Active paint returned no raster');
          next = snapshotRaster(painted, width, height); painted = null;
        } finally { for (const canvas of owned) dispose(canvas); }
        // An abort queued during synchronous paint/selection work must execute
        // before compositing or publication, even on the final layer.
        await waitCurrent(new Promise(resolve => setTimeout(resolve, 0)), opt);
        assertCurrent(opt);
        if (result) {
          const combined = compositor.composite({ width, height, data: result.rgba }, next,
            { shouldCancel: () => { assertCurrent(opt); return false; } });
          result = { width, height, rgba: bytes(combined.data, LIMITS.rgbaBytes, width * height * 4, false) };
          next = null;
        } else result = next;
      }
      await waitCurrent(new Promise(resolve => setTimeout(resolve, 0)), opt);
      assertCurrent(opt); return Object.freeze(result);
    }
    async function raster(input) {
      const o = record(input, ['layers', 'context', 'width', 'height', 'signal', 'isCurrent'],
        ['layers', 'context', 'width', 'height'], 'paint raster request');
      dimensions(o.width, o.height);
      const context = snapshotContext(o.context), layers = layersCore.validate(o.layers, context), opt = controls(o);
      opt.shouldCancel = context.shouldCancel || null;
      return renderValidated(layers, context, o.width, o.height, opt);
    }
    async function digest(owned, opt) {
      assertCurrent(opt);
      check(crypto && crypto.subtle && typeof crypto.subtle.digest === 'function', 'SHA-256 is unavailable');
      const result = await waitCurrent(crypto.subtle.digest('SHA-256', owned), opt);
      const view = bytes(result, 32, 32, true);
      let hex = ''; for (let i = 0; i < 32; i++) hex += view[i].toString(16).padStart(2, '0');
      assertCurrent(opt); return hex;
    }
    async function hashBytes(value, options) {
      const opt = controls(record(options === undefined ? {} : options, ['signal', 'isCurrent'], [], 'hash options'));
      assertCurrent(opt);
      return digest(copyBytes(value, LIMITS.sourceBytes, undefined, true), opt);
    }
    function snapshotRaster(value, width, height) {
      const r = record(value, ['width', 'height', 'rgba'], ['width', 'height', 'rgba'], 'prepared paint raster');
      const expected = dimensions(r.width, r.height);
      if (width !== undefined) check(r.width === width && r.height === height, 'Prepared paint raster dimensions do not match');
      const rgba = copyBytes(r.rgba, LIMITS.rgbaBytes, expected, false);
      for (let i = 0; i < expected; i += 4) if (rgba[i + 3] === 0) rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
      return { width: r.width, height: r.height, rgba };
    }
    async function envelope(input) {
      const required = ['requestId', 'sourceRevision', 'sourceBytes', 'layers', 'context', 'width', 'height', 'mode'];
      const o = record(input, [...required, 'signal', 'isCurrent', 'preparedRaster', 'preparedRecipeHash'], required, 'paint export request');
      dimensions(o.width, o.height);
      const context = snapshotContext(o.context), layers = layersCore.validate(o.layers, context), opt = controls(o);
      opt.shouldCancel = context.shouldCancel || null;
      check(typeof o.requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(o.requestId), 'Invalid paint request ID');
      check(typeof o.sourceRevision === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(o.sourceRevision) &&
        !['__proto__', 'constructor', 'prototype'].includes(o.sourceRevision), 'Invalid paint source revision');
      check(o.sourceRevision === context.sourceRevision, 'Paint source revision does not match context');
      layersCore.plan(o.width, o.height, layers, context);
      check(o.mode === 'original' || o.mode === 'working', 'Invalid paint export mode');
      assertCurrent(opt);
      if (!layersCore.isActive(layers)) return null;
      check(has(o, 'preparedRaster') === has(o, 'preparedRecipeHash'), 'Prepared raster and recipe hash must be supplied together');
      const prepared = has(o, 'preparedRaster') ? snapshotRaster(o.preparedRaster, o.width, o.height) : null;
      if (prepared) check(typeof o.preparedRecipeHash === 'string' && /^[a-f0-9]{64}$/.test(o.preparedRecipeHash), 'Invalid prepared recipe hash');
      let source = copyBytes(o.sourceBytes, LIMITS.sourceBytes, undefined, true);
      check(source.length > 0, 'Empty encoded source');
      const canonical = layersCore.canonicalRecipe(layers);
      check(typeof canonical === 'string' && canonical.length <= 2000000, 'Invalid canonical paint recipe');
      const recipeBytes = new TextEncoder().encode(canonical);
      const sourceHash = await digest(source, opt); source = null;
      const recipeHash = await digest(recipeBytes, opt);
      if (prepared) check(o.preparedRecipeHash === recipeHash, 'Prepared raster recipe hash does not match');
      const painted = prepared || await renderValidated(layers, context, o.width, o.height, opt);
      assertCurrent(opt);
      return Object.freeze({ version: 1, requestId: o.requestId, sourceRevision: o.sourceRevision,
        sourceHash, recipeHash, mode: o.mode, width: o.width, height: o.height, rgba: painted.rgba });
    }
    function compositePreview(baseCanvas, value, options) {
      const opt = controls(record(options === undefined ? {} : options, ['signal', 'isCurrent'], [], 'preview options'));
      check(baseCanvas && typeof baseCanvas.getContext === 'function', 'A base preview Canvas is required');
      issued.add(baseCanvas); // Borrowed inputs must never be reissued by the host factory.
      const width = baseCanvas.width, height = baseCanvas.height;
      dimensions(width, height); assertCurrent(opt);
      if (value === null) return baseCanvas;
      // Validate and snapshot before allocating any canvases. The overlay is
      // measured ONLY at final export dimensions. Reuse its bytes directly at
      // equal dimensions; a needless Canvas roundtrip can alter low-alpha RGB.
      const r = snapshotRaster(value);
      let full, scaled, output, published = false;
      try {
        let overlay = r.rgba;
        if (width !== r.width || height !== r.height) {
          full = makeCanvas(r.width, r.height); putPixels(full.ctx, r.width, r.height, r.rgba); assertCurrent(opt);
          scaled = makeCanvas(width, height);
          scaled.ctx.imageSmoothingEnabled = true; scaled.ctx.imageSmoothingQuality = 'high';
          scaled.ctx.drawImage(full.canvas, 0, 0, r.width, r.height, 0, 0, width, height); assertCurrent(opt);
          overlay = readPixels(scaled.ctx, width, height);
          dispose(full.canvas); full = null;
          dispose(scaled.canvas); scaled = null;
        }
        assertCurrent(opt);
        const baseCtx = baseCanvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
        check(baseCtx, 'Base preview Canvas 2D is unavailable');
        const base = readPixels(baseCtx, width, height); assertCurrent(opt);
        check(compositor && typeof compositor.composite === 'function', 'Straight-sRGB compositor is unavailable');
        const combined = compositor.composite({ width, height, data: base }, { width, height, rgba: overlay },
          { shouldCancel: () => { assertCurrent(opt); return false; } });
        assertCurrent(opt);
        check(combined && combined.width === width && combined.height === height, 'Composite returned mismatched dimensions');
        bytes(combined.data, LIMITS.rgbaBytes, width * height * 4, false);
        output = makeCanvas(width, height); putPixels(output.ctx, width, height, combined.data);
        assertCurrent(opt); published = true; return output.canvas;
      } finally {
        if (full) dispose(full.canvas);
        if (scaled) dispose(scaled.canvas);
        if (output && !published) dispose(output.canvas);
      }
    }
    return Object.freeze({ raster, envelope, compositePreview, hashBytes });
  }
  return Object.freeze({ LIMITS, create });
});
