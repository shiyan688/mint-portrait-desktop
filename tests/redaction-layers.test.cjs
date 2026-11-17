'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const R = require('../src/redaction-layers.cjs');
const Core = require('../src/redact-core.cjs').createProfile('desktop');
const Manual = require('../src/manual-tools.cjs');
const Geometry = require('../src/geometry.cjs');
const Padding = require('../src/canvas-padding.cjs');
function context(w = 8, h = 8, settings = {}) { return { sourceRevision: 'source:1', settings, sourceSize: { width: w, height: h } }; }
function recipe(overrides = {}) { return { version: 1, mode: 'cover', blockSize: .25, color: '#123456', strokes: [{ radius: .5, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }] }], ...overrides }; }
function layer(overrides = {}) { return { id: 'redact1', name: '遮挡 1', enabled: true, recipe: recipe(), selection: null, ...overrides }; }
function value(c = context(), layers = [layer()]) { return { version: 1, sourceRevision: c.sourceRevision, geometryKey: R.geometryKey(c.settings), layers }; }
function selection(overrides = {}) { return { version: 1, sourceRevision: 'source:1', base: 'none', inverted: false, feather: 0,
  commands: [{ kind: 'brush', mode: 'add', radius: .2, points: [{ x: .25, y: .5 }] }], ...overrides }; }
function image(width = 8, height = 8) { return { width, height, data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => (i * 97 + 31) % 256) }; }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function pixel(data, i) { return Array.from(data.slice(i * 4, i * 4 + 4)); }
function expectLimit(fn) { assert.throws(fn, e => e instanceof RangeError && /LIMIT/.test(e.code)); }

test('UMD exports, immutable limits and null identity defaults', () => {
  assert.deepEqual(Object.keys(R).sort(), ['LIMITS', 'defaults', 'geometryKey', 'validate', 'isActive', 'plan', 'apply'].sort());
  assert.equal(R.defaults(), null); assert.equal(R.validate(null), null); assert.equal(R.isActive(null), false);
  assert.ok(Object.isFrozen(R) && Object.isFrozen(R.LIMITS));
  const code = fs.readFileSync(require.resolve('../src/redaction-layers.cjs'), 'utf8');
  let amd;
  const define = (names, factory) => { assert.equal(names.length, 6); amd = factory(require('../src/redact-core.cjs'), Manual, Geometry, Padding, require('../src/straighten.cjs'), require('../src/perspective.cjs')); }; define.amd = true;
  vm.runInNewContext(code, { define }); assert.equal(typeof amd.apply, 'function');
  const sandbox = {};
  for (const file of ['redact-core', 'manual-tools', 'geometry', 'canvas-padding', 'redaction-layers']) vm.runInNewContext(fs.readFileSync(require.resolve('../src/' + file + '.cjs'), 'utf8'), sandbox);
  assert.equal(vm.runInNewContext('MintRedactionLayers.defaults()', sandbox), null);
  assert.equal(vm.runInNewContext(`(() => { const settings = {}, c = {sourceRevision:'s',settings,sourceSize:{width:1,height:1}};
    const v = {version:1,sourceRevision:'s',geometryKey:MintRedactionLayers.geometryKey(settings),layers:[{id:'a',name:'a',enabled:true,selection:null,recipe:{version:1,mode:'cover',blockSize:.1,color:'#123456',strokes:[{radius:.1,points:[{x:0,y:0}]}]}}]};
    return MintRedactionLayers.apply({width:1,height:1,data:new Uint8Array(4)},v,c).data[3]; })()`, sandbox), 255);
});

test('canonical geometry key binds normalized shape, not color adjustments or history counter', () => {
  assert.equal(R.geometryKey({}), R.geometryKey({ framing: Geometry.defaults(), canvasPadding: Padding.defaults(), manualLiquify: [], slim: -0, eyes: 0, nose: 0, jaw: 0 }));
  assert.equal(R.geometryKey({ revision: 1, exposure: 10 }), R.geometryKey({ revision: 99, exposure: 80 }));
  const parsed = JSON.parse(R.geometryKey({})); assert.deepEqual(Object.keys(parsed), ['framing', 'canvasPadding', 'manualLiquify', 'slim', 'eyes', 'nose', 'jaw']);
  for (const key of ['slim', 'eyes', 'nose', 'jaw']) assert.notEqual(R.geometryKey({ [key]: 1 }), R.geometryKey({}));
  const padding = Padding.defaults(); padding.color = '#ABCDEF'; assert.equal(R.geometryKey({ canvasPadding: padding }), R.geometryKey({ canvasPadding: { ...padding, color: '#abcdef' } }));
  assert.notEqual(R.geometryKey({ framing: { ...Geometry.defaults(), flipX: true } }), R.geometryKey({}));
  const command = { kind: 'push', sourceRevision: 'source:1', radius: .1, strength: .5, points: [{ x: .2, y: .5 }, { x: .3, y: .5 }], selection: null };
  assert.notEqual(R.geometryKey({ manualLiquify: [command] }), R.geometryKey({}));
  assert.notEqual(R.geometryKey({ manualLiquify: [command] }), R.geometryKey({ manualLiquify: [{ ...command, strength: .6 }] }));
});

test('validation returns independent, deep-frozen canonical layers and selections', () => {
  const c = context(), v = value(c, [layer({ selection: selection(), recipe: recipe({ color: '#AABBCC' }) })]);
  const out = R.validate(v, c);
  assert.equal(out.layers[0].recipe.color, '#aabbcc');
  v.layers[0].selection.commands[0].points[0].x = .9;
  assert.equal(out.layers[0].selection.commands[0].points[0].x, .25);
  function frozen(x) { if (x && typeof x === 'object') { assert.ok(Object.isFrozen(x)); for (const v of Object.values(x)) frozen(v); } }
  frozen(out);
  assert.equal(R.isActive(out), true);
  const nullProto = clone(out); Object.setPrototypeOf(nullProto, null); Object.setPrototypeOf(nullProto.layers, null);
  Object.setPrototypeOf(nullProto.layers[0].selection.commands, null);
  assert.doesNotThrow(() => R.validate(nullProto, c));
});

test('exact records reject omissions, extensions, unsafe prototypes and duplicates', () => {
  const c = context();
  for (const key of Object.keys(value(c))) { const v = value(c); delete v[key]; assert.throws(() => R.validate(v, c)); }
  for (const key of Object.keys(layer())) { const l = layer(); delete l[key]; assert.throws(() => R.validate(value(c, [l]), c)); }
  for (const key of ['extra', '__proto__', Symbol('x')]) { const v = value(c); Object.defineProperty(v, key, { enumerable: true, value: 1 }); assert.throws(() => R.validate(v, c)); }
  for (const v of [undefined, {}, [], 1, new Date(), Object.create(value(c))]) assert.throws(() => R.validate(v, c));
  assert.throws(() => R.validate(value(c, [layer(), layer()]), c));
  for (const id of ['', 'constructor', 'x y', 'x'.repeat(161)]) assert.throws(() => R.validate(value(c, [layer({ id })]), c));
  for (const name of ['', 'x'.repeat(81), 'a\nb']) assert.throws(() => R.validate(value(c, [layer({ name })]), c));
  for (const enabled of [0, 'true', null]) assert.throws(() => R.validate(value(c, [layer({ enabled })]), c));
  const sparse = value(c); sparse.layers = new Array(1); assert.throws(() => R.validate(sparse, c));
  const extended = value(c); extended.layers.extra = true; assert.throws(() => R.validate(extended, c));
});

test('getters at every input boundary are rejected without invocation', () => {
  let called = 0;
  const getter = (obj, key) => Object.defineProperty(obj, key, { enumerable: true, configurable: true, get() { called++; throw Error('must not read'); } });
  for (const target of ['root', 'layers', 'layer', 'recipe', 'stroke', 'points', 'point', 'selection', 'commands', 'selectionPoint', 'context', 'size', 'settings', 'framing', 'padding', 'liquify']) {
    const c = context(), v = value(c, [layer({ selection: selection() })]);
    switch (target) {
      case 'root': getter(v, 'sourceRevision'); break;
      case 'layers': getter(v.layers, '0'); break;
      case 'layer': getter(v.layers[0], 'enabled'); break;
      case 'recipe': getter(v.layers[0].recipe, 'mode'); break;
      case 'stroke': getter(v.layers[0].recipe.strokes[0], 'radius'); break;
      case 'points': getter(v.layers[0].recipe.strokes[0].points, '0'); break;
      case 'point': getter(v.layers[0].recipe.strokes[0].points[0], 'x'); break;
      case 'selection': getter(v.layers[0].selection, 'base'); break;
      case 'commands': getter(v.layers[0].selection.commands, '0'); break;
      case 'selectionPoint': getter(v.layers[0].selection.commands[0].points[0], 'x'); break;
      case 'context': getter(c, 'sourceRevision'); break;
      case 'size': getter(c.sourceSize, 'width'); break;
      case 'settings': getter(c.settings, 'unrelated'); break;
      case 'framing': c.settings.framing = Geometry.defaults(); getter(c.settings.framing.crop, 'x'); break;
      case 'padding': c.settings.canvasPadding = Padding.defaults(); getter(c.settings.canvasPadding, 'color'); break;
      case 'liquify': c.settings.manualLiquify = [{}]; getter(c.settings.manualLiquify[0], 'sourceRevision'); break;
    }
    assert.throws(() => R.validate(v, c), target);
  }
  const custom = selection(); Object.setPrototypeOf(custom.commands, { get map() { called++; } });
  assert.throws(() => R.validate(value(context(), [layer({ selection: custom })]), context()));
  assert.equal(called, 0);
});

test('stale source and geometry reject without altering stored strokes', () => {
  const c = context(), v = value(c), before = clone(v);
  assert.throws(() => R.validate(v, { ...c, sourceRevision: 'source:2' }), { code: 'REDACTION_LAYERS_STALE_SOURCE' });
  assert.throws(() => R.validate(v, { ...c, settings: { ...c.settings, jaw: 1 } }), { code: 'REDACTION_LAYERS_STALE_GEOMETRY' });
  assert.throws(() => R.validate(v, { ...c, settings: { framing: { ...Geometry.defaults(), flipY: true } } }), { code: 'REDACTION_LAYERS_STALE_GEOMETRY' });
  assert.throws(() => R.validate(value(c, [layer({ selection: selection({ sourceRevision: 'source:2' }) })]), c));
  assert.deepEqual(v, before);
  assert.doesNotThrow(() => R.validate(v, { ...c, settings: { revision: 6, contrast: 44 } }));
});

test('selected layers fail closed with unwarped automatic or manual shaping', () => {
  for (const shape of ['slim', 'eyes', 'nose', 'jaw']) {
    const c = context(8, 8, { [shape]: 1 });
    assert.throws(() => R.validate(value(c, [layer({ selection: selection() })]), c), { code: 'REDACTION_LAYERS_UNWARPED_SELECTION' });
    assert.doesNotThrow(() => R.validate(value(c), c));
  }
  const command = { kind: 'push', sourceRevision: 'source:1', radius: .1, strength: .5, points: [{ x: .2, y: .5 }, { x: .3, y: .5 }], selection: null };
  const c = context(8, 8, { manualLiquify: [command] });
  assert.throws(() => R.validate(value(c, [layer({ selection: selection() })]), c), { code: 'REDACTION_LAYERS_UNWARPED_SELECTION' });
  command.strength = 0; assert.doesNotThrow(() => R.validate(value(c, [layer({ selection: selection() })]), c));
});

test('null, empty, disabled and empty-stroke identity still validate image and cancellation', () => {
  const c = context(), im = image(), before = im.data.slice();
  for (const v of [null, value(c, []), value(c, [layer({ enabled: false })]), value(c, [layer({ recipe: recipe({ strokes: [] }) })])]) {
    assert.equal(R.apply(im, v, c), im); assert.equal(R.isActive(v), false);
    assert.equal(R.plan(8, 8, v, c).workPixels, 0);
    assert.throws(() => R.apply(im, v, { ...c, shouldCancel: () => true }), { name: 'AbortError' });
  }
  assert.deepEqual(im.data, before);
  assert.throws(() => R.apply({ width: 1, height: 1, data: new Uint8Array(3) }, null));
});

test('image schema and native RGBA buffers are strict, getter-free and non-shared', () => {
  for (const data of [Buffer.alloc(4), new Uint16Array(4), new Float32Array(4), [], new Uint8Array(3), new (class extends Uint8Array {})(4)]) assert.throws(() => R.apply({ width: 1, height: 1, data }, null));
  if (typeof SharedArrayBuffer === 'function') assert.throws(() => R.apply({ width: 1, height: 1, data: new Uint8Array(new SharedArrayBuffer(4)) }, null));
  if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')) assert.throws(() => R.apply({ width: 1, height: 1, data: new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })) }, null));
  let called = 0; const im = { width: 1, height: 1, get data() { called++; } }; assert.throws(() => R.apply(im, null));
  assert.equal(called, 0);
  for (const [width, height] of [[0, 1], ['1', 1], [16385, 1], [4096, 4097]]) expectLimit(() => R.plan(width, height, null));
  const data = new Uint8Array(4); Object.defineProperty(data, 'length', { get() { called++; } });
  assert.equal(R.apply({ width: 1, height: 1, data }, null).data, data); assert.equal(called, 0);
});

test('unselected cover matches shared core exactly including alpha255 over transparent pixels', () => {
  const c = context(), im = image(); for (let i = 3; i < im.data.length; i += 4) im.data[i] = 0;
  const before = im.data.slice(), v = value(c), out = R.apply(im, v, c), expected = Core.apply(im, v.layers[0].recipe);
  assert.deepEqual(out.data, expected.data); assert.notEqual(out.data.buffer, im.data.buffer);
  assert.deepEqual(pixel(out.data, 0), [18, 52, 86, 255]); assert.deepEqual(im.data, before);
  assert.deepEqual(Object.keys(out), ['width', 'height', 'data']);
});

test('binary selection clips cover once and preserves outside bytes including hidden RGB', () => {
  const c = context(), im = image(), selected = selection();
  for (let i = 3; i < im.data.length; i += 4) im.data[i] = 0;
  const before = im.data.slice(), mask = Manual.rasterizeSelection(8, 8, selected, c), out = R.apply(im, value(c, [layer({ selection: selected })]), c);
  for (let i = 0; i < mask.length; i++) assert.deepEqual(pixel(out.data, i), mask[i] === 1 ? [18, 52, 86, 255] : pixel(before, i));
  assert.deepEqual(im.data, before);
  assert.throws(() => R.validate(value(c, [layer({ selection: selection({ feather: .001 }) })]), c), /unfeathered/);
});

test('mosaic feather blends the core result only once, preserving alpha and every weight-zero byte', () => {
  const c = context(20, 12), im = image(20, 12), selected = selection({ feather: .1 });
  const r = recipe({ mode: 'mosaic' }), expected = Core.apply(im, r), mask = Manual.rasterizeSelection(20, 12, selected, c);
  const out = R.apply(im, value(c, [layer({ recipe: r, selection: selected })]), c), before = im.data.slice(); let fractional = 0;
  for (let i = 0; i < mask.length; i++) {
    const w = mask[i], j = i * 4;
    const bytes = new Uint8ClampedArray(4);
    for (let k = 0; k < 3; k++) bytes[k] = before[j + k] * (1 - w) + expected.data[j + k] * w;
    bytes[3] = before[j + 3];
    assert.deepEqual(pixel(out.data, i), Array.from(bytes));
    if (w > 0 && w < 1) fractional++;
  }
  assert.ok(fractional > 0); assert.deepEqual(im.data, before);
});

// Independent point mapping: source crop -> clockwise turn -> output-axis flips.
function mappedMask(sourceMask, w, h, framing, padding) {
  const c = framing.crop, x0 = Math.max(0, Math.min(w - 1, Math.round(c.x * w))), y0 = Math.max(0, Math.min(h - 1, Math.round(c.y * h)));
  const cw = Math.max(x0 + 1, Math.min(w, Math.round((c.x + c.w) * w))) - x0;
  const ch = Math.max(y0 + 1, Math.min(h, Math.round((c.y + c.h) * h))) - y0;
  const gw = framing.quarterTurns % 2 ? ch : cw, gh = framing.quarterTurns % 2 ? cw : ch, edge = Math.min(gw, gh);
  const top = Math.round(padding.top * edge), left = Math.round(padding.left * edge);
  const ow = gw + left + Math.round(padding.right * edge), oh = gh + top + Math.round(padding.bottom * edge), out = new Float32Array(ow * oh);
  for (let sy = 0; sy < ch; sy++) for (let sx = 0; sx < cw; sx++) {
    let dx, dy;
    switch (framing.quarterTurns) {
      case 0: dx = sx; dy = sy; break;
      case 1: dx = ch - 1 - sy; dy = sx; break;
      case 2: dx = cw - 1 - sx; dy = ch - 1 - sy; break;
      case 3: dx = sy; dy = cw - 1 - sx; break;
    }
    if (framing.flipX) dx = gw - 1 - dx;
    if (framing.flipY) dy = gh - 1 - dy;
    out[(dy + top) * ow + dx + left] = sourceMask[(sy + y0) * w + sx + x0];
  }
  return { width: ow, height: oh, mask: out };
}

test('crop, all quarter turns, flips and colored padding transport exact Float32 mask bytes', () => {
  for (const quarterTurns of [0, 1, 2, 3]) for (const flipX of [false, true]) for (const flipY of [false, true]) for (const mode of ['cover', 'mosaic']) {
    const framing = { ...Geometry.defaults(), crop: { x: .12, y: .08, w: .76, h: .84 }, quarterTurns, flipX, flipY };
    const canvasPadding = { ...Padding.defaults(), left: .4, top: .25, right: .15, bottom: .2, color: '#ff00dd', opacity: .8 };
    const c = context(17, 13, { framing, canvasPadding }), selected = selection({ feather: mode === 'cover' ? 0 : .08 });
    const mask = Manual.rasterizeSelection(17, 13, selected, c), expected = mappedMask(mask, 17, 13, framing, canvasPadding);
    const im = image(expected.width, expected.height), r = recipe({ mode }), unselected = Core.apply(im, r), out = R.apply(im, value(c, [layer({ recipe: r, selection: selected })]), c);
    for (let i = 0; i < expected.mask.length; i++) {
      const weight = expected.mask[i], j = i * 4, p = new Uint8ClampedArray(4);
      for (let k = 0; k < 4; k++) p[k] = weight === 1 ? unselected.data[j + k] : weight === 0 ? im.data[j + k] : k === 3 ? im.data[j + k] : im.data[j + k] * (1 - weight) + unselected.data[j + k] * weight;
      assert.deepEqual(pixel(out.data, i), Array.from(p), `${quarterTurns}/${flipX}/${flipY}/${mode}/${i}`);
    }
  }
});

test('unselected strokes include padding while selected all-source selection excludes padding', () => {
  const canvasPadding = { ...Padding.defaults(), left: .5, top: .5 }, c = context(4, 4, { canvasPadding }), im = image(6, 6);
  const unselected = R.apply(im, value(c), c), selected = R.apply(im, value(c, [layer({ selection: selection({ base: 'all', commands: [] }) })]), c);
  assert.deepEqual(pixel(unselected.data, 0), [18, 52, 86, 255]); assert.deepEqual(pixel(selected.data, 0), pixel(im.data, 0));
  assert.deepEqual(pixel(selected.data, 14), [18, 52, 86, 255]);
  assert.throws(() => R.plan(5, 6, value(c, [layer({ selection: selection() })]), c), /match final canvas/);
});

test('layers execute in stored order and each mosaic samples its immutable layer source', () => {
  const c = context(), im = image(), a = layer({ recipe: recipe({ color: '#ff0000', strokes: [{ radius: .002, points: [{ x: 0, y: 0 }] }] }) });
  const b = layer({ id: 'mosaic', name: 'mosaic', recipe: recipe({ mode: 'mosaic' }) });
  const out = R.apply(im, value(c, [a, b]), c), expected = Core.apply(Core.apply(im, a.recipe), b.recipe);
  assert.deepEqual(out.data, expected.data); assert.notDeepEqual(R.apply(im, value(c, [b, a]), c).data, out.data);
  assert.deepEqual(im.data, image().data);
});

test('aggregate layer, stroke and point budgets include disabled layers', () => {
  const c = context();
  expectLimit(() => R.validate(value(c, Array.from({ length: 9 }, (_, i) => layer({ id: 'r' + i }))), c));
  const s = { radius: .1, points: [{ x: .5, y: .5 }] };
  const a = layer({ enabled: false, recipe: recipe({ strokes: Array.from({ length: 64 }, () => s) }) });
  expectLimit(() => R.validate(value(c, [a, layer({ id: 'r2' })]), c));
  const points = Array.from({ length: 2048 }, () => ({ x: .5, y: .5 }));
  const make = (id, n) => layer({ id, recipe: recipe({ strokes: [{ radius: .1, points: points.slice(0, n) }] }) });
  assert.doesNotThrow(() => R.validate(value(c, [make('a', 2048), make('b', 2048)]), c));
  expectLimit(() => R.validate(value(c, [make('a', 2048), make('b', 2048), make('c', 1)]), c));
});

test('aggregate work, per-call core work, raster and memory limits are checked by allocation-free plans', () => {
  const simple = recipe({ strokes: [{ radius: .1, points: [{ x: .5, y: .5 }] }] });
  const c = context(4096, 4096);
  const layers = Array.from({ length: 4 }, (_, i) => layer({ id: 'r' + i, recipe: simple }));
  // Three 16Mi rasters also exceed retained-output memory; either resource fails closed.
  expectLimit(() => R.plan(4096, 4096, value(c, layers), c));
  const workContext = context(2048, 2048), workLayers = Array.from({ length: 8 }, (_, i) => layer({ id: 'm' + i, recipe: { ...simple, mode: 'mosaic' } }));
  const p = R.plan(2048, 2048, value(workContext, workLayers), workContext); assert.ok(p.workPixels < 128000000);
  const selectedLayers = workLayers.map(l => ({ ...l, selection: selection({ base: 'all', commands: [] }) }));
  expectLimit(() => R.plan(2048, 2048, value(workContext, selectedLayers), workContext));
  const hugeSource = context(4096, 4097);
  assert.doesNotThrow(() => R.plan(8, 8, value(hugeSource), hugeSource));
  expectLimit(() => R.plan(8, 8, value(hugeSource, [layer({ selection: selection() })]), hugeSource));
  const featherContext = context(3000, 3000);
  expectLimit(() => R.plan(3000, 3000, value(featherContext, [layer({ recipe: { ...simple, mode: 'mosaic' }, selection: selection({ feather: .1 }) })]), featherContext));
  const expensive = recipe({ mode: 'mosaic', strokes: [{ radius: .5, points: Array.from({ length: 4096 }, (_, i) => ({ x: i % 2, y: i % 2 })) }] });
  expectLimit(() => R.plan(4096, 4096, value(c, [layer({ recipe: expensive })]), c));
});

test('oversized arrays and strings reject before accessor traversal', () => {
  let called = 0;
  const c = context(), v = value(c); v.layers = new Array(9); Object.defineProperty(v.layers, '0', { get() { called++; } });
  expectLimit(() => R.validate(v, c));
  const long = value(c); long.geometryKey = 'x'.repeat(R.LIMITS.maxGeometryKeyLength + 1); assert.throws(() => R.validate(long, c));
  const selected = selection(); selected.commands[0].points = new Array(4097); Object.defineProperty(selected.commands[0].points, '0', { get() { called++; } });
  expectLimit(() => R.validate(value(c, [layer({ selection: selected })]), c));
  assert.equal(called, 0);
});

test('cooperative cancellation never returns partial work or mutates input or recipe', () => {
  const c = context(64, 64), im = image(64, 64), v = value(c, [layer({ recipe: recipe({ mode: 'mosaic' }), selection: selection({ feather: .1 }) })]);
  const original = im.data.slice(), saved = clone(v);
  for (const threshold of [1, 4, 10, 20, 50]) {
    let calls = 0;
    assert.throws(() => R.apply(im, v, { ...c, shouldCancel: () => ++calls === threshold }), { name: 'AbortError' });
    assert.deepEqual(im.data, original); assert.deepEqual(v, saved);
  }
});

test('cancellation callback detachment fails closed even when it returns false', () => {
  if (typeof structuredClone !== 'function') return;
  const c = context(), im = image(), v = value(c); let once = false;
  assert.throws(() => R.apply(im, v, { ...c, shouldCancel: () => { if (!once) { once = true; structuredClone(im.data.buffer, { transfer: [im.data.buffer] }); } return false; } }), /unavailable/);
});

test('nonbinary or nonfinite transported cover masks fail closed, never blend alpha', () => {
  for (const bad of [.5, NaN, Infinity, -1]) {
    const sandbox = {};
    for (const file of ['redact-core', 'manual-tools', 'geometry', 'canvas-padding']) vm.runInNewContext(fs.readFileSync(require.resolve('../src/' + file + '.cjs'), 'utf8'), sandbox);
    vm.runInNewContext(`(() => { const manual = MintManualTools; globalThis.MintManualTools = { ...manual,
      rasterizeSelection(...args) { const mask = manual.rasterizeSelection(...args); mask[0] = ${String(bad)}; return mask; } }; })()`, sandbox);
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/redaction-layers.cjs'), 'utf8'), sandbox);
    const result = vm.runInNewContext(`(() => { const settings={},c={sourceRevision:'s',settings,sourceSize:{width:1,height:1}},im={width:1,height:1,data:new Uint8Array([7,8,9,0])};
      const v={version:1,sourceRevision:'s',geometryKey:MintRedactionLayers.geometryKey(settings),layers:[{id:'a',name:'a',enabled:true,
        recipe:{version:1,mode:'cover',blockSize:.1,color:'#ffffff',strokes:[{radius:.1,points:[{x:0,y:0}]}]},
        selection:{version:1,sourceRevision:'s',base:'all',inverted:false,feather:0,commands:[]}}]};
      try { MintRedactionLayers.apply(im,v,c); return 'accepted'; } catch(e) { return e.message + ':' + Array.from(im.data).join(','); } })()`, sandbox);
    assert.match(result, /Invalid or nonbinary cover selection mask:7,8,9,0/);
  }
});

test('selection snapshots are independently captured for every layer', () => {
  const c = context(), selected = selection(), v = value(c, [layer({ selection: selected }), layer({ id: 'b', selection: selected })]);
  const normalized = R.validate(v, c);
  assert.notEqual(normalized.layers[0].selection, normalized.layers[1].selection);
  assert.notEqual(normalized.layers[0].selection.commands[0].points, normalized.layers[1].selection.commands[0].points);
  selected.base = 'all'; selected.commands.length = 0;
  assert.equal(normalized.layers[0].selection.base, 'none'); assert.equal(normalized.layers[1].selection.commands.length, 1);
});

test('bounded geometry key fails before persistence and array/metadata cycles are rejected', () => {
  const maxKey = R.LIMITS.maxGeometryKeyLength;
  assert.ok(Number.isSafeInteger(maxKey) && maxKey > 0);
  const boundary = value(); boundary.geometryKey = 'x'.repeat(maxKey);
  assert.equal(R.isActive(boundary), true, 'the advertised string boundary is accepted structurally');
  boundary.geometryKey += 'x';
  assert.throws(() => R.isActive(boundary), /Geometry key is invalid/, 'one byte past the advertised boundary is rejected');
  const densePoints = count => Array.from({ length: count }, (_, i) => ({ x: (i + 1) / (count + 1), y: (i + 2) / (count + 2) }));
  const commands = [{ kind: 'push', sourceRevision: 'source:1', radius: .1, strength: .5,
    points: densePoints(Manual.LIMITS.liquifyPoints),
    selection: selection({ commands: [{ kind: 'brush', mode: 'add', radius: .1, points: densePoints(Manual.LIMITS.selectionPoints) }] }) }];
  assert.doesNotThrow(() => Manual.validateLiquifyCommands(commands, { sourceRevision: 'source:1' }), 'oversize binding contains otherwise valid manual recipes');
  assert.ok(JSON.stringify(commands).length > maxKey, 'fixture actually exceeds the current geometry key budget');
  assert.throws(() => R.geometryKey({ manualLiquify: commands }), /Geometry key exceeds/);
  const cycle = []; cycle.push(cycle); assert.throws(() => R.geometryKey({ manualLiquify: cycle }), /budget/);
  const settings = Object.fromEntries(Array.from({ length: 129 }, (_, i) => ['a' + i, 0]));
  expectLimit(() => R.geometryKey(settings));
});

test('disabled collections cannot silently rebind stale geometry or source', () => {
  const c = context(), v = value(c, [layer({ enabled: false })]);
  assert.equal(R.isActive(v), false);
  assert.throws(() => R.apply(image(), v, { ...c, sourceRevision: 'source:2' }), { code: 'REDACTION_LAYERS_STALE_SOURCE' });
  assert.throws(() => R.apply(image(), v, { ...c, settings: { eyes: 1 } }), { code: 'REDACTION_LAYERS_STALE_GEOMETRY' });
});

test('shared redaction core remains the frozen reviewed desktop-profile adapter', () => {
  const hash = require('node:crypto').createHash('sha256').update(fs.readFileSync(require.resolve('../src/redact-core.cjs'))).digest('hex');
  assert.equal(hash, '14abf070ebc42e9942e4a847d672ff4a53c1769ee66276de4e24ff86e6b62be8');
});
