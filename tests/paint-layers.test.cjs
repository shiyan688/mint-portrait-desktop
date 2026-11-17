'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
// Required native backend: absence must fail, never silently skip raster QA.
const Native = require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
const L = require('../src/paint-layers.cjs');
const Core = require('../src/paint-layer.cjs').createProfile('desktop');
const Manual = require('../src/manual-tools.cjs');
const Geometry = require('../src/geometry.cjs');
const Padding = require('../src/canvas-padding.cjs');
const context = (w = 100, h = 80, settings = {}) => ({ sourceRevision: 'source:1', settings, sourceSize: { width: w, height: h } });
const stroke = (o = {}) => ({ mode: 'paint', color: '#ef4010', width: .12, opacity: .7, points: [{ x: .15, y: .5 }, { x: .85, y: .5 }], ...o });
const layer = (o = {}) => ({ id: 'paint1', name: '画笔 1', enabled: true, recipe: { version: 1, strokes: [stroke()] }, selection: null, ...o });
const value = (c = context(), layers = [layer()]) => ({ version: 1, sourceRevision: c.sourceRevision, geometryKey: L.geometryKey(c.settings), layers });
const selection = (o = {}) => ({ version: 1, sourceRevision: 'source:1', base: 'none', inverted: false, feather: .08, commands: [{ kind: 'brush', mode: 'add', radius: .2, points: [{ x: .5, y: .5 }] }], ...o });
const render = (v, c = context(), w = c.sourceSize.width, h = c.sourceSize.height, opts = {}) => L.render(w, h, v, c, { createCanvas: Native.createCanvas, ...opts });
const clone = x => JSON.parse(JSON.stringify(x));
const pixel = (d, i) => Array.from(d.slice(i * 4, i * 4 + 4));
function corePixels(w, h, r) { const canvas = Core.renderLayer(w, h, r, { createCanvas: Native.createCanvas }); const bytes = new Uint8Array(canvas.getContext('2d').getImageData(0, 0, w, h).data); canvas.width = canvas.height = 1; return bytes; }
function sourceOver(base, top) {
  const out = base.slice();
  for (let i = 0; i < top.length; i += 4) {
    const a = top[i + 3] / 255, b = base[i + 3] / 255, alpha = a + b * (1 - a);
    if (!a) continue;
    for (let k = 0; k < 3; k++) out[i + k] = Math.round((top[i + k] * a + base[i + k] * b * (1 - a)) / alpha);
    out[i + 3] = Math.round(alpha * 255);
  }
  return out;
}

test('frozen exact UMD API and null defaults', () => {
  assert.deepEqual(Object.keys(L).sort(), ['LIMITS', 'defaults', 'geometryKey', 'validate', 'isActive', 'plan', 'canonicalRecipe', 'render'].sort());
  assert.ok(Object.isFrozen(L) && Object.isFrozen(L.LIMITS)); assert.equal(L.defaults(), null); assert.equal(L.validate(null), null); assert.equal(L.canonicalRecipe(null), 'null');
  const sandbox = {};
  for (const file of ['paint-layer', 'redact-core', 'manual-tools', 'geometry', 'canvas-padding', 'redaction-layers', 'paint-layers']) vm.runInNewContext(fs.readFileSync(require.resolve('../src/' + file + '.cjs'), 'utf8'), sandbox);
  assert.equal(vm.runInNewContext('MintPaintLayers.validate(null)', sandbox), null);
  let amd; const define = (names, factory) => { assert.equal(names.length, 6); amd = factory(require('../src/paint-layer.cjs'), require('../src/redaction-layers.cjs'), Manual, Geometry, Padding, require('../src/straighten.cjs')); }; define.amd = true;
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/paint-layers.cjs'), 'utf8'), { define }); assert.equal(amd.defaults(), null);
});

test('deep immutable snapshots capture independent selections and canonical recipes', () => {
  const c = context(), selected = selection(), v = value(c, [layer({ selection: selected }), layer({ id: 'b', selection: selected })]);
  const result = L.validate(v, c); v.layers[0].recipe.strokes[0].color = '#ffffff'; selected.commands[0].points[0].x = .9;
  assert.equal(result.layers[0].recipe.strokes[0].color, '#ef4010'); assert.equal(result.layers[1].selection.commands[0].points[0].x, .5);
  assert.notEqual(result.layers[0].selection, result.layers[1].selection);
  function frozen(o) { if (o && typeof o === 'object') { assert.ok(Object.isFrozen(o)); for (const v of Object.values(o)) frozen(v); } } frozen(result);
  assert.equal(L.canonicalRecipe(result), L.canonicalRecipe(JSON.parse(JSON.stringify(result))));
  const other = value(); other.layers[0].recipe.strokes[0].color = '#EF4010'; assert.equal(L.canonicalRecipe(other), L.canonicalRecipe(value()));
});

test('exact collection schema rejects unsafe records, sparse arrays and duplicate IDs', () => {
  const c = context();
  for (const key of Object.keys(value())) { const v = value(); delete v[key]; assert.throws(() => L.validate(v, c)); }
  for (const key of Object.keys(layer())) { const l = layer(); delete l[key]; assert.throws(() => L.validate(value(c, [l]), c)); }
  for (const bad of [undefined, [], {}, 1, new Date(), Object.create(value())]) assert.throws(() => L.validate(bad, c));
  for (const key of ['extra', '__proto__', Symbol('x')]) { const v = value(); Object.defineProperty(v, key, { enumerable: true, value: 1 }); assert.throws(() => L.validate(v, c)); }
  assert.throws(() => L.validate(value(c, [layer(), layer()]), c));
  for (const id of ['', 'constructor', 'a b', 'x'.repeat(161)]) assert.throws(() => L.validate(value(c, [layer({ id })]), c));
  for (const name of ['', 'x'.repeat(81), 'a\nb']) assert.throws(() => L.validate(value(c, [layer({ name })]), c));
  const sparse = value(); sparse.layers = new Array(1); assert.throws(() => L.validate(sparse, c));
  const custom = value(); Object.setPrototypeOf(custom.layers, { map() { throw Error('unsafe'); } }); assert.throws(() => L.validate(custom, c));
});

test('every collection and context descriptor boundary rejects getters without calling them', () => {
  let called = 0;
  const getter = (o, k) => Object.defineProperty(o, k, { enumerable: true, configurable: true, get() { called++; throw Error('getter executed'); } });
  const attacks = [
    (v) => getter(v, 'sourceRevision'), (v) => getter(v.layers, '0'), (v) => getter(v.layers[0], 'enabled'),
    (v) => getter(v.layers[0].recipe, 'strokes'), (v) => getter(v.layers[0].recipe.strokes, '0'),
    (v) => getter(v.layers[0].recipe.strokes[0], 'width'), (v) => getter(v.layers[0].recipe.strokes[0].points, '0'),
    (v) => getter(v.layers[0].recipe.strokes[0].points[0], 'x'), (v) => getter(v.layers[0].selection, 'base'),
    (v) => getter(v.layers[0].selection.commands, '0'), (v) => getter(v.layers[0].selection.commands[0].points[0], 'x'),
    (v, c) => getter(c, 'sourceSize'), (v, c) => getter(c.sourceSize, 'width'), (v, c) => getter(c.settings, 'unrelated'),
    (v, c) => { c.settings.framing = Geometry.defaults(); getter(c.settings.framing.crop, 'x'); },
    (v, c) => { c.settings.manualLiquify = []; getter(c.settings.manualLiquify, '0'); },
    (v, c) => { c.settings.canvasPadding = Padding.defaults(); getter(c.settings.canvasPadding, 'color'); }
  ];
  for (const attack of attacks) { const c = context(), v = value(c, [layer({ selection: selection() })]); attack(v, c); assert.throws(() => L.validate(v, c)); }
  assert.equal(called, 0);
});

test('all stored layers bind source and geometry, even empty/disabled; color changes are irrelevant', () => {
  const c = context();
  for (const layers of [[], [layer({ enabled: false })], [layer({ recipe: { version: 1, strokes: [] } })]]) {
    const v = value(c, layers);
    assert.throws(() => L.validate(v, { ...c, sourceRevision: 'source:2' }), { code: 'PAINT_LAYERS_STALE_SOURCE' });
    assert.throws(() => L.validate(v, { ...c, settings: { eyes: 1 } }), { code: 'PAINT_LAYERS_STALE_GEOMETRY' });
  }
  assert.doesNotThrow(() => L.validate(value(c), { ...c, settings: { exposure: 80, revision: 100 } }));
  assert.equal(L.geometryKey({}), require('../src/redaction-layers.cjs').geometryKey({}));
});

test('selection cannot silently survive auto/manual warp or mismatched source', () => {
  for (const key of ['slim', 'eyes', 'nose', 'jaw']) {
    const c = context(100, 80, { [key]: 1 });
    assert.throws(() => L.validate(value(c, [layer({ selection: selection(), enabled: false })]), c), { code: 'PAINT_LAYERS_UNWARPED_SELECTION' });
    assert.doesNotThrow(() => L.validate(value(c), c));
  }
  const command = { kind: 'push', sourceRevision: 'source:1', radius: .1, strength: .5, points: [{ x: .2, y: .5 }, { x: .3, y: .5 }], selection: null };
  const c = context(100, 80, { manualLiquify: [command] });
  assert.throws(() => L.validate(value(c, [layer({ selection: selection() })]), c), { code: 'PAINT_LAYERS_UNWARPED_SELECTION' });
  command.strength = 0; assert.doesNotThrow(() => L.validate(value(c, [layer({ selection: selection() })]), c));
  command.sourceRevision = 'other'; assert.throws(() => L.validate(value(c), c), { code: 'PAINT_LAYERS_STALE_SOURCE' });
});

test('inactive output never allocates, but still validates dimensions and cancellation', () => {
  let allocations = 0; const c = context(), createCanvas = () => { allocations++; throw Error('allocated'); };
  for (const v of [null, value(c, []), value(c, [layer({ enabled: false })]), value(c, [layer({ recipe: { version: 1, strokes: [stroke({ mode: 'erase' })] } })])]) {
    assert.equal(L.render(100, 80, v, c, { createCanvas }), null); assert.equal(L.isActive(v), false); assert.equal(L.plan(100, 80, v, c).workPixels, 0);
    assert.throws(() => L.render(100, 80, v, c, { createCanvas, shouldCancel: () => true }), { name: 'AbortError' });
  }
  for (const [w, h] of [[0, 1], [16385, 1], [4001, 4000], [1.5, 1]]) assert.throws(() => L.render(w, h, null, undefined, { createCanvas }));
  assert.equal(allocations, 0); assert.equal(L.plan(4000, 4000, null).pixels, 16000000);
});

test('layer/stroke/point aggregate budgets include disabled recipes', () => {
  const c = context(); assert.throws(() => L.validate(value(c, Array.from({ length: 5 }, (_, i) => layer({ id: 'p' + i }))), c), /budget/);
  const recipe = { version: 1, strokes: Array.from({ length: 128 }, () => stroke()) };
  assert.throws(() => L.validate(value(c, [layer({ enabled: false, recipe }), layer({ id: 'b' })]), c), /budget/);
  recipe.strokes = Array.from({ length: 8 }, () => stroke({ points: Array.from({ length: 1024 }, () => ({ x: .5, y: .5 })) }));
  assert.doesNotThrow(() => L.validate(value(c, [layer({ recipe })]), c));
  assert.throws(() => L.validate(value(c, [layer({ recipe }), layer({ id: 'b' })]), c), /budget/);
});

test('plans expose conservative memory/work and reject aggregate erasure before any allocation', () => {
  const c = context(4000, 4000), r = { version: 1, strokes: [stroke(), stroke({ mode: 'erase', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })] };
  let allocations = 0;
  assert.throws(() => L.render(4000, 4000, value(c, ['a', 'b', 'c'].map(id => layer({ id, recipe: r }))), c, { createCanvas() { allocations++; } }), /Aggregate paint erasure/);
  assert.equal(allocations, 0);
  const p = L.plan(100, 80, value(), context());
  assert.ok(p.extraBytes > p.pixels * 12); assert.ok(p.workPixels > p.pixels * 2); assert.ok(Object.isFrozen(p.layers));
  assert.equal(p.layers[0].rgbaBytes, 32000); assert.equal(p.layers[0].canvasBytes, 32000);
  const selected = value(c, [layer({ selection: selection({ base: 'all', commands: [] }) })]);
  assert.throws(() => L.plan(4000, 4000, selected, c), /work budget/);
});

test('unselected metadata source may be larger when final is cropped; selected source is limited to 16M', () => {
  const c = context(8000, 8000, { framing: { ...Geometry.defaults(), crop: { x: 0, y: 0, w: .1, h: .1 } } });
  assert.doesNotThrow(() => L.plan(800, 800, value(c), c));
  assert.throws(() => L.plan(800, 800, value(c, [layer({ selection: selection() })]), c), /budget/);
});

test('native layer isolation: top eraser never removes bottom paint and array order is source-over', () => {
  const c = context(), a = layer({ recipe: { version: 1, strokes: [stroke({ color: '#0000ff', opacity: 1 })] } });
  const b = layer({ id: 'top', recipe: { version: 1, strokes: [stroke({ color: '#ff0000', opacity: .8 }), stroke({ mode: 'erase', width: .08, opacity: 1, points: [{ x: .5, y: .5 }] })] } });
  const v = value(c, [a, b]), before = clone(v), out = render(v, c), bottom = corePixels(100, 80, a.recipe), top = corePixels(100, 80, b.recipe);
  assert.deepEqual(out.rgba, sourceOver(bottom, top)); assert.deepEqual(pixel(out.rgba, 40 * 100 + 50), [0, 0, 255, 255]);
  assert.notDeepEqual(render(value(c, [b, a]), c).rgba, out.rgba); assert.deepEqual(v, before);
});

test('native feather selection multiplies final layer alpha once, never RGB or per-stroke coverage', () => {
  const c = context(), selected = selection(), r = { version: 1, strokes: [stroke(), stroke({ opacity: .4, color: '#20e040' }), stroke({ mode: 'erase', opacity: .25 })] };
  const expected = corePixels(100, 80, r), mask = Manual.rasterizeSelection(100, 80, selected, c), out = render(value(c, [layer({ recipe: r, selection: selected })]), c);
  let fractional = 0;
  for (let i = 0; i < mask.length; i++) {
    const j = i * 4, a = Math.round(expected[j + 3] * mask[i]);
    assert.deepEqual(pixel(out.rgba, i), a ? [expected[j], expected[j + 1], expected[j + 2], a] : [0, 0, 0, 0]);
    if (a > 0 && mask[i] > 0 && mask[i] < 1) fractional++;
  }
  assert.ok(fractional > 0);
});

function movedMask(mask, w, h, f, pad) {
  const x0 = Math.round(f.crop.x * w), y0 = Math.round(f.crop.y * h);
  const cw = Math.max(x0 + 1, Math.round((f.crop.x + f.crop.w) * w)) - x0, ch = Math.max(y0 + 1, Math.round((f.crop.y + f.crop.h) * h)) - y0;
  const gw = f.quarterTurns % 2 ? ch : cw, gh = f.quarterTurns % 2 ? cw : ch, short = Math.min(gw, gh);
  const left = Math.round(pad.left * short), top = Math.round(pad.top * short), ow = gw + left + Math.round(pad.right * short), oh = gh + top + Math.round(pad.bottom * short), out = new Float32Array(ow * oh);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    let dx, dy; switch (f.quarterTurns) { case 0: dx = x; dy = y; break; case 1: dx = ch - 1 - y; dy = x; break; case 2: dx = cw - 1 - x; dy = ch - 1 - y; break; case 3: dx = y; dy = cw - 1 - x; }
    if (f.flipX) dx = gw - 1 - dx; if (f.flipY) dy = gh - 1 - dy;
    out[(dy + top) * ow + dx + left] = mask[(y + y0) * w + x + x0];
  }
  return { width: ow, height: oh, mask: out };
}

test('native source selection exact crop/quarter-turn/flip/padding transport matches independent mapping', () => {
  for (const quarterTurns of [0, 1, 2, 3]) for (const flipX of [false, true]) for (const flipY of [false, true]) {
    const framing = { ...Geometry.defaults(), crop: { x: .1, y: .1, w: .8, h: .8 }, quarterTurns, flipX, flipY };
    const canvasPadding = { ...Padding.defaults(), top: .2, left: .3, bottom: .1, right: .15, color: '#ff00ff', opacity: 1 };
    const c = context(40, 30, { framing, canvasPadding }), s = selection(), original = Manual.rasterizeSelection(40, 30, s, c), expected = movedMask(original, 40, 30, framing, canvasPadding);
    const r = { version: 1, strokes: [stroke({ points: [{ x: .1, y: .4 }, { x: .9, y: .7 }] })] };
    const plain = corePixels(expected.width, expected.height, r), out = render(value(c, [layer({ recipe: r, selection: s })]), c, expected.width, expected.height);
    for (let i = 0; i < expected.mask.length; i++) { const j = i * 4, alpha = Math.round(plain[j + 3] * expected.mask[i]); assert.deepEqual(pixel(out.rgba, i), alpha ? [...plain.slice(j, j + 3), alpha] : [0, 0, 0, 0]); }
    assert.throws(() => L.plan(expected.width + 1, expected.height, value(c, [layer({ selection: s })]), c), /match final canvas/);
  }
});

test('reused factory surfaces are rejected without changing previously issued canvas dimensions', () => {
  const c = context(), canvas = Native.createCanvas(100, 80), factory = () => canvas;
  render(value(c), c, 100, 80, { createCanvas: factory }); const dimensions = [canvas.width, canvas.height];
  assert.throws(() => render(value(c), c, 100, 80, { createCanvas: factory }), /reused|unshared/);
  assert.deepEqual([canvas.width, canvas.height], dimensions);
});

test('allocation/readback errors and cancellation dispose every owned surface, never return partial bytes', () => {
  const c = context(), created = []; let polls = 0;
  assert.throws(() => render(value(c, [layer({ recipe: { version: 1, strokes: [stroke(), stroke({ mode: 'erase' })] } })]), c, 100, 80, {
    createCanvas(w, h) { const canvas = Native.createCanvas(w, h); created.push(canvas); return canvas; }, shouldCancel: () => ++polls > 6
  }), { name: 'AbortError' });
  assert.ok(created.length > 0); for (const canvas of created) assert.ok(canvas.width <= 1 && canvas.height <= 1);
  const canvas = Native.createCanvas(100, 80), ctx = canvas.getContext('2d'); ctx.getImageData = () => ({ width: 100, height: 80, data: new Uint8Array(new SharedArrayBuffer(32000)) });
  assert.throws(() => render(value(c), c, 100, 80, { createCanvas: () => canvas }), /fixed|native/); assert.ok(canvas.width <= 1);
});
