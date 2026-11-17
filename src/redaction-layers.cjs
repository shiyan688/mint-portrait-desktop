/* Desktop final-canvas redaction. Shared MintRedact mathematics remain unchanged.
 * Source selections are transported as four opaque Float32 bytes, never colors. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(
    require('./redact-core.cjs'), require('./manual-tools.cjs'), require('./geometry.cjs'), require('./canvas-padding.cjs'), require('./straighten.cjs'), require('./perspective.cjs'));
  else if (typeof define === 'function' && define.amd) define(
    ['MintRedact', 'MintManualTools', 'MintGeometry', 'MintCanvasPadding', 'MintStraighten', 'MintPerspective'], factory);
  else root.MintRedactionLayers = factory(root.MintRedact, root.MintManualTools, root.MintGeometry, root.MintCanvasPadding, root.MintStraighten, root.MintPerspective);
})(typeof globalThis === 'object' ? globalThis : this, function (SharedRedact, Manual, Geometry, Padding, Straighten, Perspective) {
  'use strict';
  const Core = SharedRedact && SharedRedact.createProfile('desktop');
  const LIMITS = Object.freeze({ maxLayers: 8, maxStrokes: 64, maxTotalPoints: 4096,
    maxPixels: 16777216, maxEdge: 16384, maxWorkPixels: 128000000,
    maxExtraBytes: 128 * 1024 * 1024, maxGeometryKeyLength: 262144,
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
  function fail(message, code) {
    const e = code === 'LIMIT' ? new RangeError(message) : new TypeError(message);
    e.code = 'REDACTION_LAYERS_' + (code || 'INVALID'); throw e;
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
  function normalizedSettings(value) {
    const s = record(value, null, [], 'Settings');
    if (!Geometry || !Padding || !Manual || !Core) fail('Shared redaction dependencies are unavailable');
    const framing = Geometry.validate(own(s, 'framing') ? s.framing : null);
    const canvasPadding = !own(s, 'canvasPadding') || s.canvasPadding === null ? Padding.defaults() : Padding.validate(s.canvasPadding);
    const commands = own(s, 'manualLiquify') ? dataCopy(s.manualLiquify) : [];
    if (!Array.isArray(commands)) fail('manualLiquify must be an array');
    let manualLiquify = [];
    if (commands.length) {
      const first = record(commands[0], ['kind', 'sourceRevision', 'radius', 'strength', 'points', 'selection'],
        ['sourceRevision'], 'Liquify command');
      manualLiquify = Manual.validateLiquifyCommands(commands, { sourceRevision: string(first.sourceRevision, 160, 'Liquify source revision') });
    }
    const out = { framing, canvasPadding, manualLiquify };
    // Absence/null/exact zero keep every pre-v14 binding byte-identical.
    if (own(s, 'straighten') && s.straighten != null) {
      if (!Straighten) fail('Shared straighten dependency is unavailable');
      const recipe = Straighten.validate(s.straighten);
      if (recipe.angle !== 0) out.straighten = recipe;
    }
    // Neutral/absent recipes keep every legacy geometry key byte-identical.
    if (own(s, 'perspective') && s.perspective !== null) {
      if (s.perspective === undefined) fail('Perspective recipe must be null or a complete record');
      if (!Perspective) fail('Shared perspective dependency is unavailable');
      const recipe = Perspective.validate(s.perspective);
      if (Perspective.isActive(recipe)) out.perspective = recipe;
    }
    for (const key of ['slim', 'eyes', 'nose', 'jaw']) out[key] = own(s, key) ? finite(s[key], key === 'slim' || key === 'eyes' ? 0 : -100, 100, key) : 0;
    if (own(s, 'faceAdjustments') && s.faceAdjustments !== null) {
      const people = typeof module === 'object' && module.exports ? require('./portrait-people-desktop.cjs') : globalThis.MintPortraitPeopleDesktop;
      if (!people) fail('Per-person geometry validator is unavailable');
      const binding = people.geometryBinding(s.faceAdjustments);
      if (binding !== null) out.faceGeometry = binding;
    }
    return out;
  }
  function keyFor(s) {
    const key = JSON.stringify(s);
    if (key.length > LIMITS.maxGeometryKeyLength) fail('Geometry key exceeds its budget', 'LIMIT');
    return key;
  }
  function geometryKey(settings) { return keyFor(normalizedSettings(settings)); }
  function context(value, required) {
    if (value === undefined && !required) return null;
    const c = record(value, ['sourceRevision', 'settings', 'sourceSize', 'shouldCancel'],
      required ? ['sourceRevision', 'settings', 'sourceSize'] : [], 'Context');
    if (own(c, 'shouldCancel') && typeof c.shouldCancel !== 'function') fail('shouldCancel must be a function');
    const out = { shouldCancel: own(c, 'shouldCancel') ? c.shouldCancel : null };
    if (own(c, 'sourceRevision')) out.sourceRevision = string(c.sourceRevision, 160, 'Source revision');
    if (own(c, 'settings')) { out.settings = normalizedSettings(c.settings); out.geometryKey = keyFor(out.settings); }
    if (own(c, 'sourceSize')) {
      const ss = record(c.sourceSize, ['width', 'height'], ['width', 'height'], 'Source size');
      size(ss.width, ss.height, false); out.sourceSize = { width: ss.width, height: ss.height };
    }
    return out;
  }
  function structure(value) {
    if (value === null) return null;
    const r = record(value, ROOT_KEYS, ROOT_KEYS, 'Redaction layers');
    if (r.version !== 1) fail('Unsupported redaction layers version');
    const sourceRevision = string(r.sourceRevision, 160, 'Source revision');
    const geometryKey = string(r.geometryKey, LIMITS.maxGeometryKeyLength, 'Geometry key');
    const input = array(r.layers, LIMITS.maxLayers, 'Layers'), ids = new Set();
    let strokes = 0, points = 0;
    const layers = input.map(item => {
      const l = record(item, LAYER_KEYS, LAYER_KEYS, 'Layer');
      const id = string(l.id, 160, 'Layer ID');
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(id) || ['__proto__', 'prototype', 'constructor'].includes(id) || ids.has(id)) fail('Invalid or duplicate layer ID');
      ids.add(id);
      const name = string(l.name, 80, 'Layer name');
      if (typeof l.enabled !== 'boolean') fail('Layer enabled must be boolean');
      if (!Core || !Manual) fail('Shared redaction dependencies are unavailable');
      const recipe = Core.validate(l.recipe);
      strokes += recipe.strokes.length;
      for (const stroke of recipe.strokes) points += stroke.points.length;
      if (strokes > LIMITS.maxStrokes || points > LIMITS.maxTotalPoints) fail('Aggregate stroke/point budget exceeded', 'LIMIT');
      const selection = l.selection === null ? null : Manual.validateSelection(dataCopy(l.selection), { sourceRevision });
      if (selection && recipe.mode === 'cover' && selection.feather !== 0) fail('Cover requires a binary, unfeathered selection');
      return { id, name, enabled: l.enabled, recipe, selection };
    });
    return { version: 1, sourceRevision, geometryKey, layers };
  }
  function bound(value, c) {
    const r = structure(value);
    if (!r) return null;
    if (r.sourceRevision !== c.sourceRevision) fail('Redaction belongs to another source revision', 'STALE_SOURCE');
    if (r.geometryKey !== c.geometryKey) fail('Redaction geometry changed; strokes were not moved or cleared', 'STALE_GEOMETRY');
    const s = c.settings;
    if (s.perspective && r.layers.some(l => l.selection !== null)) fail('Selected redaction cannot follow perspective; reset perspective or explicitly remove the captured selection', 'UNSUPPORTED_PERSPECTIVE_SELECTION');
    if (s.straighten && s.straighten.angle % 90 !== 0 && r.layers.some(l => l.selection !== null)) fail('Selected redaction cannot follow arbitrary-angle straighten; reset straighten or remove the captured selection explicitly', 'UNSUPPORTED_STRAIGHTEN_SELECTION');
    if (s.manualLiquify.some(command => command.sourceRevision !== c.sourceRevision)) fail('Liquify belongs to another source revision', 'STALE_SOURCE');
    if (r.layers.some(l => l.selection !== null) && (s.manualLiquify.some(command => command.strength !== 0) ||
      ['slim', 'eyes', 'nose', 'jaw'].some(key => s[key] !== 0) || s.faceGeometry != null)) fail('Selected redaction cannot use an unwarped selection with shape changes', 'UNWARPED_SELECTION');
    return r;
  }
  function defaults() { return null; }
  function validate(value, inputContext) {
    const c = context(inputContext, value !== null);
    return freeze(bound(value, c));
  }
  function isActive(value) { const r = structure(value); return !!r && r.layers.some(l => l.enabled && l.recipe.strokes.length > 0); }
  function cancel(c) {
    if (c && c.shouldCancel && c.shouldCancel()) { const e = new Error('Redaction layers cancelled'); e.name = 'AbortError'; e.code = 'REDACTION_LAYERS_CANCELLED'; throw e; }
  }
  // Same conservative raster visit estimate used by ManualTools.selectionCost.
  // Kept here because that private estimator is not part of its public API.
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
  function prepare(width, height, r, c) {
    // Covers retained canonical metadata and a second shared-validator snapshot.
    // Input image storage is caller-owned and not charged as extra memory.
    const metadata = 2 * (metadataBytes(r) + metadataBytes(c && c.settings));
    const pixels = size(width, height, true), layers = []; let workPixels = 0, extraBytes = 0, activeLayers = 0, strokeCount = 0, totalPoints = 0;
    for (const layer of r ? r.layers : []) {
      strokeCount += layer.recipe.strokes.length;
      for (const stroke of layer.recipe.strokes) totalPoints += stroke.points.length;
      const active = layer.enabled && layer.recipe.strokes.length > 0;
      if (!active) { layers.push({ id: layer.id, active: false, workPixels: 0, extraBytes: 0 }); continue; }
      const core = Core.plan(width, height, layer.recipe), retained = activeLayers ? pixels * 4 : 0;
      let work = core.workPixels, bytes = metadata + retained + core.extraBytes;
      if (layer.selection) {
        const ss = c.sourceSize, n = size(ss.width, ss.height, true);
        const g = Geometry.plan(ss.width, ss.height, c.settings.framing);
        const straight = c.settings.straighten ? Straighten.plan(g.outputSize.width, g.outputSize.height, c.settings.straighten) : null;
        const straightSize = straight ? straight.outputSize : g.outputSize;
        size(straightSize.width, straightSize.height, true);
        const p = Padding.plan(straightSize.width, straightSize.height, c.settings.canvasPadding,
          { maxPixels: LIMITS.maxPixels, maxEdge: LIMITS.maxEdge });
        if (p.outputSize.width !== width || p.outputSize.height !== height) fail('Transported selection does not match final canvas dimensions');
        const geometryPixels = g.outputSize.width * g.outputSize.height;
        const moveGeometry = Geometry.isActive(c.settings.framing), movePadding = Object.values(p.padding).some(v => v !== 0);
        work += selectionCost(ss.width, ss.height, layer.selection) + (moveGeometry ? geometryPixels : 0) +
          (straight ? straight.estimates.workUnits : 0) + (movePadding ? pixels : 0) + pixels * 2;
        const rasterBytes = n * (layer.selection.feather > 0 ? 8 : 4) + (Math.max(ss.width, ss.height) + 1) * 8;
        // Conservative retained-buffer sum, not an unproven GC/lifetime peak.
        const transportBytes = straight ? n * 4 + (moveGeometry ? geometryPixels * 4 : 0) + straight.estimates.extraBytes + (movePadding ? pixels * 4 : 0) : Math.max(moveGeometry ? n * 4 + geometryPixels * 4 : n * 4, movePadding ? geometryPixels * 4 + pixels * 4 : geometryPixels * 4);
        bytes = metadata + Math.max(retained + rasterBytes + 2097152, retained + transportBytes + 2097152,
          retained + pixels * 4 + core.extraBytes);
      }
      activeLayers++; workPixels += work; extraBytes = Math.max(extraBytes, bytes);
      if (workPixels > LIMITS.maxWorkPixels) fail('Aggregate redaction work budget exceeded', 'LIMIT');
      if (extraBytes > LIMITS.maxExtraBytes) fail('Redaction extra-buffer budget exceeded', 'LIMIT');
      layers.push({ id: layer.id, active: true, workPixels: work, extraBytes: bytes });
    }
    return freeze({ width, height, pixels, active: activeLayers > 0, layerCount: r ? r.layers.length : 0,
      activeLayers, strokeCount, totalPoints, workPixels, extraBytes, layers });
  }
  function plan(width, height, value, inputContext) {
    const c = context(inputContext, value !== null), r = bound(value, c);
    const result = prepare(width, height, r, c); cancel(c); return result;
  }
  function image(value) {
    const im = record(value, ['width', 'height', 'data'], ['width', 'height', 'data'], 'Image');
    const n = size(im.width, im.height, true), data = im.data;
    if (!data || ![Uint8Array.prototype, Uint8ClampedArray.prototype].includes(Object.getPrototypeOf(data))) fail('Image data must be native Uint8Array or Uint8ClampedArray, not Buffer');
    let buffer, offset;
    try {
      buffer = bufferOf.call(data); offset = offsetOf.call(data);
      if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || (resizable && resizable.get.call(buffer)) ||
        lengthOf.call(data) !== n * 4 || bufferLength.call(buffer) < offset + n * 4) throw Error();
      // Never consult shadowable typed-array fields or iterator/species methods.
      im.data = new Uint8Array(buffer, offset, n * 4);
    } catch (_) { fail('Image requires exact attached, fixed, non-shared RGBA8 bytes'); }
    return im;
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
  function apply(value, inputValue, inputContext) {
    const c = context(inputContext, inputValue !== null), r = bound(inputValue, c), source = image(value);
    const p = prepare(source.width, source.height, r, c);
    let current = source;
    const poll = () => {
      cancel(c);
      if (lengthOf.call(source.data) !== p.pixels * 4 || lengthOf.call(current.data) !== p.pixels * 4) fail('Source buffer became unavailable');
      return false;
    };
    poll(); if (!p.active) return value;
    for (const layer of r.layers) {
      if (!layer.enabled || !layer.recipe.strokes.length) continue;
      poll();
      let mask = null;
      if (layer.selection) {
        const moved = transport(layer.selection, c, poll);
        if (moved.width !== p.width || moved.height !== p.height) fail('Transported selection does not match final canvas dimensions');
        mask = moved.data;
        for (let i = 0; i < p.pixels; i++) {
          if ((i & 16383) === 0) poll();
          if (!Number.isFinite(mask[i]) || mask[i] < 0 || mask[i] > 1 || (layer.recipe.mode === 'cover' && mask[i] !== 0 && mask[i] !== 1)) fail('Invalid or nonbinary cover selection mask');
        }
      }
      const next = Core.apply({ width: p.width, height: p.height, data: current.data }, layer.recipe, { shouldCancel: poll });
      if (mask) {
        for (let i = 0; i < p.pixels; i++) {
          if ((i & 16383) === 0) poll();
          const weight = mask[i], j = i * 4;
          if (weight === 1) continue;
          if (weight === 0) {
            for (let k = 0; k < 4; k++) next.data[j + k] = current.data[j + k];
          } else {
            for (let k = 0; k < 3; k++) next.data[j + k] = current.data[j + k] * (1 - weight) + next.data[j + k] * weight;
            next.data[j + 3] = current.data[j + 3];
          }
        }
      }
      current = next;
    }
    poll(); return { width: p.width, height: p.height, data: current.data };
  }
  return Object.freeze({ LIMITS, defaults, geometryKey, validate, isActive, plan, apply });
});
