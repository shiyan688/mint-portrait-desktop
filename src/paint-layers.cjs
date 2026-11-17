/* Desktop paint collection. Each layer is independently painted/erased before
 * source-selection alpha clipping and straight-sRGB source-over composition. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(
    require('./paint-layer.cjs'), require('./redaction-layers.cjs'), require('./manual-tools.cjs'),
    require('./geometry.cjs'), require('./canvas-padding.cjs'), require('./straighten.cjs'));
  else if (typeof define === 'function' && define.amd) define(
    ['MintPaintLayer', 'MintRedactionLayers', 'MintManualTools', 'MintGeometry', 'MintCanvasPadding', 'MintStraighten'], factory);
  else root.MintPaintLayers = factory(root.MintPaintLayer, root.MintRedactionLayers,
    root.MintManualTools, root.MintGeometry, root.MintCanvasPadding, root.MintStraighten);
})(typeof globalThis === 'object' ? globalThis : this, function (SharedPaint, Redaction, Manual, Geometry, Padding, Straighten) {
  'use strict';
  const Core = SharedPaint && SharedPaint.createProfile('desktop');
  const LIMITS = Object.freeze({ maxLayers: 4, maxStrokes: 128, maxTotalPoints: 8192,
    maxPixels: 16000000, maxEdge: 16384, maxEraseWorkPixels: 32000000,
    maxWorkPixels: 256000000, maxExtraBytes: 256 * 1024 * 1024,
    maxGeometryKeyLength: 262144, maxCanonicalLength: 2000000,
    maxSettingsFields: 128, maxMetadataNodes: 100000 });
  const own = Function.call.bind(Object.prototype.hasOwnProperty);
  const typed = Object.getPrototypeOf(Uint8Array.prototype);
  const lengthOf = Object.getOwnPropertyDescriptor(typed, 'length').get;
  const bufferOf = Object.getOwnPropertyDescriptor(typed, 'buffer').get;
  const offsetOf = Object.getOwnPropertyDescriptor(typed, 'byteOffset').get;
  const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable');
  const ROOT_KEYS = ['version', 'sourceRevision', 'geometryKey', 'layers'];
  const LAYER_KEYS = ['id', 'name', 'enabled', 'recipe', 'selection'];
  const issued = new WeakSet();
  function fail(message, code) {
    const e = code === 'LIMIT' ? new RangeError(message) : new TypeError(message);
    e.code = 'PAINT_LAYERS_' + (code || 'INVALID'); throw e;
  }
  function record(value, allowed, required, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(label + ' must be a plain record');
    const names = Reflect.ownKeys(value), out = Object.create(null);
    if (names.length > (allowed ? allowed.length : LIMITS.maxSettingsFields)) fail(label + ' has too many fields', 'LIMIT');
    for (const key of names) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || key.length > 160 || ['__proto__', 'constructor', 'prototype'].includes(key) ||
        (allowed && !allowed.includes(key)) || !d || !d.enumerable || !own(d, 'value')) fail(label + ' has an unsafe field');
      out[key] = d.value;
    }
    for (const key of required) if (!own(out, key)) fail(label + ' is missing ' + key);
    return out;
  }
  function array(value, max, label) {
    if (!Array.isArray(value) || ![Array.prototype, null].includes(Object.getPrototypeOf(value))) fail(label + ' must be an ordinary array');
    const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!descriptor || !own(descriptor, 'value') || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) fail(label + ' has invalid length');
    const length = descriptor.value;
    if (length > max) fail(label + ' exceeds its count budget', 'LIMIT');
    const names = Reflect.ownKeys(value);
    if (names.length !== length + 1) fail(label + ' must be dense with no extra fields');
    const out = new Array(length);
    for (const key of names) {
      if (key === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length ||
        String(Number(key)) !== key || !d || !d.enumerable || !own(d, 'value')) fail(label + ' has an unsafe item');
      out[Number(key)] = d.value;
    }
    return out;
  }
  function finite(value, lo, hi, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(label + ' must be a finite number');
    if (value < lo || value > hi) fail(label + ' is out of range', 'LIMIT');
    return value === 0 ? 0 : value;
  }
  function string(value, max, label) {
    if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(label + ' is invalid');
    return value;
  }
  function size(width, height, selected) {
    const edge = selected ? LIMITS.maxEdge : 65535, pixels = selected ? LIMITS.maxPixels : 268000000;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > edge || height > edge || width * height > pixels) fail('Dimensions exceed the integer edge or pixel budget', 'LIMIT');
    return width * height;
  }
  function freeze(value) {
    if (value && typeof value === 'object') { for (const k of Object.keys(value)) freeze(value[k]); Object.freeze(value); }
    return value;
  }
  // ManualTools predates strict array-prototype checking. Give that shared
  // validator a bounded, descriptor-only copy instead of untrusted objects.
  function dataCopy(value, state = { nodes: 0 }, depth = 0) {
    if (++state.nodes > LIMITS.maxMetadataNodes || depth > 12) fail('Geometry/selection metadata exceeds its budget', 'LIMIT');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return finite(value, -Number.MAX_VALUE, Number.MAX_VALUE, 'Metadata number');
    if (typeof value === 'string') { if (value.length > 160) fail('Metadata string exceeds budget', 'LIMIT'); return value; }
    if (Array.isArray(value)) return array(value, 4096, 'Metadata array').map(item => dataCopy(item, state, depth + 1));
    const input = record(value, null, [], 'Metadata'), out = Object.create(null);
    for (const key of Object.keys(input)) out[key] = dataCopy(input[key], state, depth + 1);
    return out;
  }
  function geometryKey(settings) {
    if (!Redaction || typeof Redaction.geometryKey !== 'function') fail('Shared geometry binding is unavailable');
    return Redaction.geometryKey(settings);
  }
  function context(value, required) {
    if (value === undefined && !required) return null;
    const c = record(value, ['sourceRevision', 'settings', 'sourceSize', 'shouldCancel'],
      required ? ['sourceRevision', 'settings', 'sourceSize'] : [], 'Context');
    if (own(c, 'shouldCancel') && typeof c.shouldCancel !== 'function') fail('shouldCancel must be a function');
    const out = { shouldCancel: own(c, 'shouldCancel') ? c.shouldCancel : null };
    if (own(c, 'sourceRevision')) out.sourceRevision = string(c.sourceRevision, 160, 'Source revision');
    if (own(c, 'settings')) { out.geometryKey = geometryKey(c.settings); out.settings = JSON.parse(out.geometryKey); }
    if (own(c, 'sourceSize')) {
      const ss = record(c.sourceSize, ['width', 'height'], ['width', 'height'], 'Source size');
      size(ss.width, ss.height, false); out.sourceSize = { width: ss.width, height: ss.height };
    }
    return out;
  }
  function structure(value) {
    if (value === null) return null;
    const r = record(value, ROOT_KEYS, ROOT_KEYS, 'Paint layers');
    if (r.version !== 1) fail('Unsupported paint layers version');
    const sourceRevision = string(r.sourceRevision, 160, 'Source revision');
    const key = string(r.geometryKey, LIMITS.maxGeometryKeyLength, 'Geometry key');
    const input = array(r.layers, LIMITS.maxLayers, 'Layers'), ids = new Set();
    let strokes = 0, points = 0;
    const layers = input.map(item => {
      const l = record(item, LAYER_KEYS, LAYER_KEYS, 'Layer');
      const id = string(l.id, 160, 'Layer ID');
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(id) || ['__proto__', 'prototype', 'constructor'].includes(id) || ids.has(id)) fail('Invalid or duplicate layer ID');
      ids.add(id);
      const name = string(l.name, 80, 'Layer name');
      if (typeof l.enabled !== 'boolean') fail('Layer enabled must be boolean');
      if (!Core || !Manual) fail('Shared paint dependencies are unavailable');
      record(l.recipe, ['version', 'strokes'], ['version', 'strokes'], 'Paint recipe');
      const recipe = Core.validate(l.recipe);
      strokes += recipe.strokes.length;
      for (const stroke of recipe.strokes) points += stroke.points.length;
      if (strokes > LIMITS.maxStrokes || points > LIMITS.maxTotalPoints) fail('Aggregate stroke/point budget exceeded', 'LIMIT');
      const selection = l.selection === null ? null : Manual.validateSelection(dataCopy(l.selection), { sourceRevision });
      return { id, name, enabled: l.enabled, recipe, selection };
    });
    return { version: 1, sourceRevision, geometryKey: key, layers };
  }
  function bound(value, c) {
    const r = structure(value);
    if (!r) return null;
    if (r.sourceRevision !== c.sourceRevision) fail('Paint belongs to another source revision', 'STALE_SOURCE');
    if (r.geometryKey !== c.geometryKey) fail('Paint geometry changed; strokes were not moved or cleared', 'STALE_GEOMETRY');
    const s = c.settings;
    if (s.perspective && r.layers.some(l => l.selection !== null)) fail('Selected paint cannot follow perspective; reset perspective or explicitly remove the captured selection', 'UNSUPPORTED_PERSPECTIVE_SELECTION');
    if (s.straighten && s.straighten.angle % 90 !== 0 && r.layers.some(l => l.selection !== null)) fail('Selected paint cannot follow arbitrary-angle straighten; reset straighten or remove the captured selection explicitly', 'UNSUPPORTED_STRAIGHTEN_SELECTION');
    if (s.manualLiquify.some(command => command.sourceRevision !== c.sourceRevision)) fail('Liquify belongs to another source revision', 'STALE_SOURCE');
    if (r.layers.some(l => l.selection !== null)) {
      size(c.sourceSize.width, c.sourceSize.height, true);
      if (s.manualLiquify.some(command => command.strength !== 0) || ['slim', 'eyes', 'nose', 'jaw'].some(key => s[key] !== 0) || s.faceGeometry != null)
        fail('Selected paint cannot use an unwarped selection with shape changes', 'UNWARPED_SELECTION');
    }
    return r;
  }
  function defaults() { return null; }
  function validate(value, inputContext) { return freeze(bound(value, context(inputContext, value !== null))); }
  function active(layer) { return layer.enabled && layer.recipe.strokes.some(s => s.mode === 'paint' && s.opacity > 0); }
  function isActive(value) { const r = structure(value); return !!r && r.layers.some(active); }
  function canonicalRecipe(value) {
    const result = JSON.stringify(structure(value));
    if (result.length > LIMITS.maxCanonicalLength) fail('Canonical paint recipe exceeds its budget', 'LIMIT');
    return result;
  }
  function cancel(c) {
    if (c && c.shouldCancel && c.shouldCancel()) { const e = new Error('Paint layers cancelled'); e.name = 'AbortError'; e.code = 'PAINT_LAYERS_CANCELLED'; throw e; }
  }
  function selectionCost(w, h, selection) {
    let work = w * h * (selection.feather > 0 ? 18 : 2);
    function rect(ax, ay, bx, by, radius) {
      const x0 = Math.max(0, Math.ceil(Math.min(ax, bx) - radius)), y0 = Math.max(0, Math.ceil(Math.min(ay, by) - radius));
      const x1 = Math.min(w - 1, Math.floor(Math.max(ax, bx) + radius)), y1 = Math.min(h - 1, Math.floor(Math.max(ay, by) + radius));
      return { width: Math.max(0, x1 - x0 + 1), height: Math.max(0, y1 - y0 + 1) };
    }
    for (const command of selection.commands) {
      const p = command.points.map(v => ({ x: v.x * (w - 1), y: v.y * (h - 1) }));
      if (command.kind === 'brush') {
        const radius = command.radius * Math.min(w, h);
        for (let i = 0; i < Math.max(1, p.length - 1); i++) {
          const a = p[i], b = p[Math.min(i + 1, p.length - 1)], box = rect(a.x, a.y, b.x, b.y, radius);
          work += box.width * box.height * 4;
        }
      } else {
        let x0 = w, y0 = h, x1 = 0, y1 = 0;
        for (const point of p) { x0 = Math.min(x0, point.x); y0 = Math.min(y0, point.y); x1 = Math.max(x1, point.x); y1 = Math.max(y1, point.y); }
        const box = rect(x0, y0, x1, y1, 0);
        work += box.height * (p.length * (6 + Math.ceil(Math.log2(p.length))) + box.width);
      }
    }
    return work;
  }
  function metadataBytes(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'string') return 32 + value.length * 2;
    if (typeof value !== 'object') return 16;
    let bytes = 256;
    for (const key of Object.keys(value)) bytes += 16 + metadataBytes(value[key]);
    return bytes;
  }
  function transport(selection, c, poll) {
    const ss = c.sourceSize, opts = { shouldCancel: poll };
    let mask = Manual.rasterizeSelection(ss.width, ss.height, selection, { sourceRevision: c.sourceRevision, shouldCancel: poll });
    let bytes = { width: ss.width, height: ss.height, data: new Uint8Array(bufferOf.call(mask), offsetOf.call(mask), lengthOf.call(mask) * 4) };
    mask = null;
    if (Geometry.isActive(c.settings.framing)) bytes = Geometry.apply(bytes, c.settings.framing, opts);
    // Never interpolate packed Float32 bytes. Only the shared exact-turn copy
    // branch is reachable after bound() validates every saved selection.
    if (c.settings.straighten) {
      if (c.settings.straighten.angle % 90 !== 0) fail('Arbitrary-angle selection transport is unsupported', 'UNSUPPORTED_STRAIGHTEN_SELECTION');
      const planned = Straighten.plan(bytes.width, bytes.height, c.settings.straighten);
      size(planned.outputSize.width, planned.outputSize.height, true);
      bytes = Straighten.apply(bytes, c.settings.straighten, opts);
    }
    const p = Padding.measure(bytes.width, bytes.height, c.settings.canvasPadding);
    if (Object.values(p.padding).some(v => v !== 0)) bytes = Padding.apply(bytes,
      { ...c.settings.canvasPadding, color: '#000000', opacity: 0 }, { ...opts, maxPixels: LIMITS.maxPixels, maxEdge: LIMITS.maxEdge });
    return { width: bytes.width, height: bytes.height,
      data: new Float32Array(bufferOf.call(bytes.data), offsetOf.call(bytes.data), bytes.width * bytes.height) };
  }
  // Native Canvas internals are platform-owned. This conservative logical
  // visit estimate charges clear/readback, segment bounds, tile clears/draws,
  // path replay, alpha edits, selection transport and source-over separately.
  function paintWork(w, h, recipe, core) {
    let work = w * h * 2 + core.eraseTileCount * core.maxTilePixels * 2 + core.eraseWorkPixels * 4;
    for (const s of recipe.strokes) {
      if (!s.opacity) continue;
      work += s.points.length * 64 * (s.mode === 'erase' ? Math.max(1, core.eraseTileCount) : 1);
      if (s.mode !== 'paint') continue;
      const radius = s.width * Math.min(w, h) / 2 + 2;
      for (let i = 0; i < Math.max(1, s.points.length - 1); i++) {
        const a = s.points[i], b = s.points[Math.min(i + 1, s.points.length - 1)];
        const left = Math.max(0, Math.floor(Math.min(a.x, b.x) * (w - 1) - radius));
        const top = Math.max(0, Math.floor(Math.min(a.y, b.y) * (h - 1) - radius));
        const right = Math.min(w, Math.ceil(Math.max(a.x, b.x) * (w - 1) + radius));
        const bottom = Math.min(h, Math.ceil(Math.max(a.y, b.y) * (h - 1) + radius));
        work += (right - left) * (bottom - top) * 4;
      }
    }
    return work;
  }
  function prepare(width, height, r, c) {
    const pixels = size(width, height, true), metadata = 2 * (metadataBytes(r) + metadataBytes(c && c.settings));
    const layers = []; let workPixels = 0, extraBytes = 0, activeLayers = 0, strokeCount = 0, totalPoints = 0, eraseWorkPixels = 0;
    const plans = new Map();
    for (const layer of r ? r.layers : []) if (active(layer)) {
      const core = Core.plan(width, height, layer.recipe); plans.set(layer, core);
      eraseWorkPixels += core.eraseWorkPixels;
      if (eraseWorkPixels > LIMITS.maxEraseWorkPixels) fail('Aggregate paint erasure work budget exceeded', 'LIMIT');
    }
    for (const layer of r ? r.layers : []) {
      strokeCount += layer.recipe.strokes.length;
      for (const stroke of layer.recipe.strokes) totalPoints += stroke.points.length;
      if (!active(layer)) { layers.push({ id: layer.id, active: false, workPixels: 0, extraBytes: 0 }); continue; }
      const core = plans.get(layer), retainedBytes = activeLayers ? pixels * 4 : 0;
      const canvasBytes = pixels * 4, rgbaBytes = pixels * 4, eraseScratchBytes = core.maxTilePixels * 12;
      let work = paintWork(width, height, layer.recipe, core) + pixels * (activeLayers ? 2 : 1);
      // During native readback canvas + returned ImageData + owned byte copy
      // coexist. During erasure one mask canvas and two tile ImageData coexist.
      let peakBytes = retainedBytes + Math.max(canvasBytes + 2 * rgbaBytes, canvasBytes + eraseScratchBytes);
      let selectionRasterBytes = 0, selectionTransportBytes = 0;
      if (layer.selection) {
        const ss = c.sourceSize, n = size(ss.width, ss.height, true);
        const g = Geometry.plan(ss.width, ss.height, c.settings.framing);
        const straight = c.settings.straighten ? Straighten.plan(g.outputSize.width, g.outputSize.height, c.settings.straighten) : null;
        const straightSize = straight ? straight.outputSize : g.outputSize;
        size(straightSize.width, straightSize.height, true);
        const p = Padding.plan(straightSize.width, straightSize.height, c.settings.canvasPadding,
          { maxPixels: LIMITS.maxPixels, maxEdge: LIMITS.maxEdge });
        if (p.outputSize.width !== width || p.outputSize.height !== height) fail('Transported selection does not match final canvas dimensions');
        const gn = g.outputSize.width * g.outputSize.height;
        const moveGeometry = Geometry.isActive(c.settings.framing), movePadding = Object.values(p.padding).some(v => v !== 0);
        work += selectionCost(ss.width, ss.height, layer.selection) + (moveGeometry ? gn : 0) + (straight ? straight.estimates.workUnits : 0) + (movePadding ? pixels : 0) + pixels * 2;
        selectionRasterBytes = n * (layer.selection.feather > 0 ? 8 : 4) + (Math.max(ss.width, ss.height) + 1) * 8;
        selectionTransportBytes = straight ? n * 4 + (moveGeometry ? gn * 4 : 0) + straight.estimates.extraBytes + (movePadding ? pixels * 4 : 0) : Math.max(moveGeometry ? n * 4 + gn * 4 : n * 4, movePadding ? gn * 4 + pixels * 4 : gn * 4);
        peakBytes = Math.max(peakBytes, retainedBytes + rgbaBytes + Math.max(selectionRasterBytes, selectionTransportBytes));
      }
      const bytes = metadata + peakBytes + 2097152;
      activeLayers++; workPixels += work; extraBytes = Math.max(extraBytes, bytes);
      if (workPixels > LIMITS.maxWorkPixels) fail('Aggregate paint work budget exceeded', 'LIMIT');
      if (extraBytes > LIMITS.maxExtraBytes) fail('Paint extra-buffer budget exceeded', 'LIMIT');
      layers.push({ id: layer.id, active: true, workPixels: work, extraBytes: bytes, retainedBytes,
        canvasBytes, rgbaBytes, eraseScratchBytes, selectionRasterBytes, selectionTransportBytes, eraseWorkPixels: core.eraseWorkPixels });
    }
    return freeze({ width, height, pixels, active: activeLayers > 0, layerCount: r ? r.layers.length : 0,
      activeLayers, strokeCount, totalPoints, eraseWorkPixels, workPixels, extraBytes, metadataBytes: metadata, layers });
  }
  function plan(width, height, value, inputContext) {
    const c = context(inputContext, value !== null), r = bound(value, c), result = prepare(width, height, r, c);
    cancel(c); return result;
  }
  function rgba(value, expected) {
    if (!value || ![Uint8Array.prototype, Uint8ClampedArray.prototype].includes(Object.getPrototypeOf(value))) fail('Canvas requires native RGBA8 bytes');
    try {
      const buffer = bufferOf.call(value), offset = offsetOf.call(value), bytes = bufferLength.call(buffer);
      if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || (resizable && resizable.get.call(buffer)) ||
        lengthOf.call(value) !== expected || bytes > LIMITS.maxPixels * 4 || bytes < offset + expected) throw Error();
      return new Uint8Array(buffer, offset, expected);
    } catch (_) { fail('Canvas requires exact attached, fixed, bounded, non-shared RGBA8 bytes'); }
  }
  function dispose(canvas) {
    if (!canvas) return;
    try { canvas.width = 0; } catch (_) {}
    try { canvas.height = 0; } catch (_) {}
    try { if (canvas.width !== 0) canvas.width = 1; } catch (_) {}
    try { if (canvas.height !== 0) canvas.height = 1; } catch (_) {}
  }
  function defaultCanvas(w, h) {
    let canvas;
    try {
      if (typeof document !== 'undefined' && document && typeof document.createElement === 'function') {
        canvas = document.createElement('canvas');
        if (issued.has(canvas)) fail('Canvas factory reused a previously issued surface');
        canvas.width = w; canvas.height = h;
      } else if (typeof OffscreenCanvas === 'function') canvas = new OffscreenCanvas(w, h);
      else fail('No Canvas factory available; pass createCanvas');
      return canvas;
    } catch (e) { if (canvas && !issued.has(canvas)) dispose(canvas); throw e; }
  }
  function render(width, height, value, inputContext, options) {
    const c = context(inputContext, value !== null), r = bound(value, c);
    const o = record(options === undefined ? {} : options, ['createCanvas', 'shouldCancel'], [], 'Paint render options');
    for (const key of Object.keys(o)) if (typeof o[key] !== 'function') fail(key + ' must be a function');
    const p = prepare(width, height, r, c);
    const poll = () => { cancel(c); if (o.shouldCancel && o.shouldCancel()) cancel({ shouldCancel: () => true }); return false; };
    poll(); if (!p.active) return null;
    const factory = own(o, 'createCanvas') ? o.createCanvas : defaultCanvas;
    const createCanvas = (w, h) => {
      const canvas = factory(w, h);
      if (!canvas || (typeof canvas !== 'object' && typeof canvas !== 'function')) fail('Canvas factory returned no surface');
      if (issued.has(canvas)) fail('Canvas factory reused a previously issued surface');
      issued.add(canvas); return canvas;
    };
    let result = null;
    for (const layer of r.layers) {
      if (!active(layer)) continue;
      poll(); let canvas, next;
      try {
        canvas = Core.renderLayer(width, height, layer.recipe, { createCanvas, shouldCancel: poll });
        poll(); const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
        if (!ctx || typeof ctx.getImageData !== 'function') fail('Canvas readback unavailable');
        const im = ctx.getImageData(0, 0, width, height);
        if (!im || im.width !== width || im.height !== height) fail('Canvas readback dimensions mismatch');
        next = new Uint8Array(rgba(im.data, p.pixels * 4));
        poll();
      } finally { if (canvas) dispose(canvas); }
      if (layer.selection) {
        const mask = transport(layer.selection, c, poll);
        if (mask.width !== width || mask.height !== height) fail('Transported selection dimensions mismatch');
        for (let i = 0; i < p.pixels; i++) {
          if ((i & 16383) === 0) poll();
          const weight = mask.data[i], j = i * 4;
          if (!Number.isFinite(weight) || weight < 0 || weight > 1) fail('Invalid transported selection weight');
          next[j + 3] = Math.round(next[j + 3] * weight);
        }
      }
      // Sanitize every transparent overlay pixel, including transparent native
      // readback bytes and values rounded to zero by the single alpha clip.
      for (let i = 0; i < p.pixels; i++) {
        if ((i & 16383) === 0) poll();
        const j = i * 4, a = next[j + 3];
        if (!a) { next[j] = next[j + 1] = next[j + 2] = 0; continue; }
        if (!result) continue;
        const b = result[j + 3], back = b * (255 - a), alpha = a * 255 + back;
        for (let k = 0; k < 3; k++) result[j + k] = Math.round((next[j + k] * a * 255 + result[j + k] * back) / alpha);
        result[j + 3] = Math.round(alpha / 255);
      }
      if (!result) result = next;
      poll();
    }
    poll(); return Object.freeze({ width, height, rgba: result });
  }
  return Object.freeze({ LIMITS, defaults, geometryKey, validate, isActive, plan, canonicalRecipe, render });
});
