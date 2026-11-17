'use strict';
// Independent fail-closed binding, pre-raster refusal, and neutral rendering audit.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), vm = require('node:vm');
const Paint = require('../src/paint-layers.cjs'), Redact = require('../src/redaction-layers.cjs');
const Perspective = require('../src/perspective.cjs'), G = require('../src/geometry.cjs'), Padding = require('../src/canvas-padding.cjs');
const Manual = require('../src/manual-tools.cjs');
const Native = require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
const historicalKey = require('../quality/perspective-qa/project-v16-historical-manifest.json').oldGeometryKey;
const revision = 'perspective-selection:1';
const active = () => ({ version: 1, quad: [{ x: .1, y: .05 }, { x: .93, y: .12 }, { x: .88, y: .94 }, { x: .04, y: .87 }], outputFraction: { width: .75, height: .8 } });
const selection = (feather = 0) => ({ version: 1, sourceRevision: revision, base: 'none', inverted: false, feather,
  commands: [{ kind: 'brush', mode: 'add', radius: .2, points: [{ x: .31, y: .61 }] }] });
const context = (settings = {}, width = 31, height = 23) => ({ sourceRevision: revision, settings, sourceSize: { width, height } });
const paintRecipe = () => ({ version: 1, strokes: [{ mode: 'paint', color: '#ef4010', width: .12, opacity: .7, points: [{ x: .1, y: .5 }, { x: .9, y: .5 }] }] });
const redactRecipe = () => ({ version: 1, mode: 'mosaic', color: '#123456', blockSize: .1, strokes: [{ radius: .2, points: [{ x: .1, y: .5 }, { x: .9, y: .5 }] }] });
function collection(api, settings, captured = null, state = 'visible') {
  const recipe = api === Paint ? paintRecipe() : redactRecipe();
  if (state === 'empty') recipe.strokes = [];
  if (state === 'transparent') { if (api !== Paint) throw Error('Only paint has opacity'); recipe.strokes[0].opacity = 0; }
  if (state === 'erase-only') { if (api !== Paint) throw Error('Only paint has erase'); recipe.strokes[0].mode = 'erase'; }
  return { version: 1, sourceRevision: revision, geometryKey: api.geometryKey(settings), layers: [{ id: 'layer-1', name: 'Synthetic layer', enabled: state !== 'hidden', recipe, selection: captured }] };
}
const source = (width = 31, height = 23) => ({ width, height, data: Uint8Array.from({ length: width * height * 4 }, (_, i) => (i * 97 + 31) & 255) });
function instrumented(api) {
  const calls = [], dep = name => require('../src/' + name + '.cjs');
  const instrument = (obj, label, keys) => ({ ...obj, ...Object.fromEntries(keys.map(k => [k, (...args) => { calls.push(label + '.' + k); throw Error('Forbidden raster call: ' + label + '.' + k); }])) });
  const profile = name => ({ ...dep(name), createProfile(...args) { return instrument(dep(name).createProfile(...args), name, name === 'paint-layer' ? ['plan', 'renderLayer'] : ['plan', 'apply']); } });
  const replacements = { './manual-tools.cjs': instrument(Manual, 'manual', ['rasterizeSelection']), './geometry.cjs': instrument(G, 'geometry', ['plan', 'apply']),
    './canvas-padding.cjs': instrument(Padding, 'padding', ['plan', 'apply']), './straighten.cjs': instrument(dep('straighten'), 'straighten', ['plan', 'apply']),
    './perspective.cjs': instrument(Perspective, 'perspective', ['plan', 'apply']), './redact-core.cjs': profile('redact-core'), './paint-layer.cjs': profile('paint-layer') };
  const filename = require.resolve(api === Paint ? '../src/paint-layers.cjs' : '../src/redaction-layers.cjs');
  const m = new Module(filename); m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename));
  const realRequire = m.require.bind(m); m.require = name => replacements[name] || realRequire(name); m._compile(fs.readFileSync(filename, 'utf8'), filename);
  return { api: m.exports, calls };
}

for (const [name, api] of [['paint', Paint], ['redaction', Redact]]) {
  test(`${name}: absent, null and complete neutral perspective retain the exact frozen v16 geometry string`, () => {
    const variants = [{}, { perspective: null }, { perspective: Perspective.defaults() }];
    for (const s of variants) assert.equal(api.geometryKey(s), historicalKey);
    for (let quarterTurns = 0; quarterTurns < 4; quarterTurns++) for (const flipX of [false, true]) for (const flipY of [false, true]) {
      const framing = { ...G.defaults(), crop: { x: .1, y: .2, w: .7, h: .6 }, quarterTurns, flipX, flipY };
      const canvasPadding = { ...Padding.defaults(), left: .2, bottom: .1 };
      const old = { framing, canvasPadding, manualLiquify: [], straighten: { version: 1, angle: 90, mode: 'expand' }, slim: 0, eyes: 0, nose: 0, jaw: 0 };
      const expected = JSON.stringify(old);
      for (const perspective of [null, Perspective.defaults()]) assert.equal(api.geometryKey({ framing, canvasPadding, straighten: old.straighten, perspective }), expected);
    }
  });

  test(`${name}: every active corner coordinate and output fraction participates in geometry binding`, () => {
    const s = { perspective: active() }, original = api.geometryKey(s), canonical = JSON.parse(original);
    assert.deepEqual(canonical.perspective, active()); assert.notEqual(original, historicalKey);
    for (let i = 0; i < 4; i++) for (const axis of ['x', 'y']) { const changed = structuredClone(s); changed.perspective.quad[i][axis] += .002; assert.notEqual(api.geometryKey(changed), original); }
    for (const axis of ['width', 'height']) { const changed = structuredClone(s); changed.perspective.outputFraction[axis] -= .01; assert.notEqual(api.geometryKey(changed), original); }
    assert.equal(api.geometryKey({ ...s, exposure: 99, contrast: -35, revision: 100 }), original);
    assert.equal(api.geometryKey({ perspective: { outputFraction: { height: .8, width: .75 }, quad: active().quad.map(p => ({ y: p.y, x: p.x })), version: 1 } }), original);
    assert.equal(Paint.geometryKey(s), Redact.geometryKey(s));
  });

  test(`${name}: active perspective cannot rekey bound visible, hidden, or empty layers on quad edit, size edit or reset`, () => {
    const s = { perspective: active() };
    for (const state of ['visible', 'hidden', 'empty']) {
      const value = collection(api, s, null, state), before = structuredClone(value);
      for (const changed of [{ perspective: null }, { perspective: Perspective.defaults() }, { perspective: { ...active(), outputFraction: { width: .7, height: .8 } } }, { perspective: { ...active(), quad: active().quad.map((p, i) => i === 0 ? { ...p, x: .11 } : p) } }]) {
        assert.throws(() => api.validate(value, context(changed)), e => e.code.endsWith('_STALE_GEOMETRY'));
        assert.throws(() => api.plan(23, 18, value, context(changed)), e => e.code.endsWith('_STALE_GEOMETRY'));
      }
      assert.deepEqual(value, before); assert.deepEqual(api.validate(value, context(s)), before);
    }
  });

  for (const state of ['visible', 'hidden', 'empty', ...(api === Paint ? ['transparent', 'erase-only'] : [])]) {
    test(`${name}: ${state} captured source selection fails before any mask, pixel planning or raster call`, () => {
      const s = { perspective: active() }, input = collection(api, s, selection(.08), state), before = structuredClone(input);
      const spy = instrumented(api), c = context(s), unchangedSource = source(); let canvases = 0;
      const expected = e => e.code.endsWith('_UNSUPPORTED_PERSPECTIVE_SELECTION') && /cannot follow perspective/.test(e.message);
      assert.throws(() => spy.api.validate(input, c), expected);
      assert.throws(() => spy.api.plan(23, 18, input, c), expected);
      if (api === Paint) assert.throws(() => spy.api.render(23, 18, input, c, { createCanvas() { canvases++; throw Error('Canvas must never be created'); } }), expected);
      else assert.throws(() => spy.api.apply(unchangedSource, input, c), expected);
      assert.equal(canvases, 0); assert.deepEqual(spy.calls, []); assert.deepEqual(input, before); assert.deepEqual(unchangedSource, source());
    });
  }

  test(`${name}: copied crop, fraction-only resize and tiny nonneutral edits still refuse every saved selection`, () => {
    const examples = [
      { ...structuredClone(Perspective.defaults()), outputFraction: { width: .5, height: 1 } },
      { version: 1, quad: [{ x: .25, y: 0 }, { x: .75, y: 0 }, { x: .75, y: 1 }, { x: .25, y: 1 }], outputFraction: { width: .5, height: 1 } },
      { ...structuredClone(Perspective.defaults()), quad: [{ x: 1e-12, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }
    ];
    for (const perspective of examples) {
      const s = { perspective }, c = context(s), value = collection(api, s, selection(), 'hidden');
      assert.equal(Perspective.isActive(perspective), true);
      assert.throws(() => api.validate(value, c), /cannot follow perspective/);
    }
  });

  test(`${name}: selected layer cannot hide after a normal first layer or behind no-op selections`, () => {
    const s = { perspective: active() };
    for (const base of ['none', 'all']) {
      const value = collection(api, s), selected = collection(api, s, { ...selection(), base, commands: [] }, 'empty').layers[0]; selected.id = 'hidden-second';
      value.layers.push(selected); assert.throws(() => api.validate(value, context(s)), /cannot follow perspective/);
    }
  });

  test(`${name}: malformed perspective and accessors are rejected rather than silently becoming neutral`, () => {
    let calls = 0;
    const bad = [undefined, false, {}, { ...active(), version: 2 }, { ...active(), unknown: 1 }, { ...active(), outputFraction: { width: 0, height: .8 } }];
    const accessor = active(); Object.defineProperty(accessor.quad[0], 'x', { enumerable: true, get() { calls++; return .1; } }); bad.push(accessor);
    for (const perspective of bad) assert.throws(() => api.geometryKey({ perspective }));
    const s = {}; Object.defineProperty(s, 'perspective', { enumerable: true, get() { calls++; return null; } }); assert.throws(() => api.geometryKey(s));
    assert.equal(calls, 0);
  });

  test(`${name}: source-revision binding is not weakened by perspective`, () => {
    const s = { perspective: active() }, value = collection(api, s), before = structuredClone(value);
    assert.throws(() => api.validate(value, { ...context(s), sourceRevision: 'other:source' }), e => e.code.endsWith('_STALE_SOURCE'));
    assert.deepEqual(value, before);
  });
}

test('active unselected final-canvas paint and redaction render normally with no second geometry transform', () => {
  const perspective = active(), s = { perspective }, width = 23, height = 18;
  const paint = Paint.render(width, height, collection(Paint, s), context(s), { createCanvas: Native.createCanvas });
  const plainPaint = Paint.render(width, height, collection(Paint, {}), context({}), { createCanvas: Native.createCanvas });
  assert.deepEqual(paint, plainPaint); assert.ok(paint.rgba.some((v, i) => i % 4 === 3 && v > 0));
  const input = source(width, height), original = input.data.slice();
  const redacted = Redact.apply(input, collection(Redact, s), context(s)), plainRedacted = Redact.apply(input, collection(Redact, {}), context({}));
  assert.deepEqual(redacted, plainRedacted); assert.notDeepEqual(redacted.data, input.data); assert.deepEqual(input.data, original);
  assert.equal(Paint.plan(width, height, collection(Paint, s), context(s)).active, true);
  assert.equal(Redact.plan(width, height, collection(Redact, s), context(s)).active, true);
});

test('neutral perspective preserves real feathered mask weights and canonical alpha bytes exactly', () => {
  const width = 31, height = 23, captured = selection(.08), mask = Manual.rasterizeSelection(width, height, captured, { sourceRevision: revision });
  assert.ok(mask.some(v => v > 0 && v < 1));
  const unselected = Paint.render(width, height, collection(Paint, {}), context({}), { createCanvas: Native.createCanvas });
  const noPerspective = Paint.render(width, height, collection(Paint, {}, captured), context({}), { createCanvas: Native.createCanvas });
  for (const perspective of [null, Perspective.defaults()]) {
    const s = { perspective }, actual = Paint.render(width, height, collection(Paint, s, captured), context(s), { createCanvas: Native.createCanvas });
    assert.deepEqual(actual, noPerspective);
    for (let i = 0; i < mask.length; i++) {
      assert.equal(actual.rgba[i * 4 + 3], Math.round(unselected.rgba[i * 4 + 3] * mask[i]));
      if (actual.rgba[i * 4 + 3] === 0) assert.deepEqual([...actual.rgba.subarray(i * 4, i * 4 + 4)], [0, 0, 0, 0]);
    }
    const image = source(width, height), redacted = Redact.apply(image, collection(Redact, s, captured), context(s));
    assert.deepEqual(redacted, Redact.apply(image, collection(Redact, {}, captured), context({})));
  }
});

test('browser UMD binding rejects hidden selections with no Canvas or model runtime', () => {
  const c = vm.createContext({ Uint8Array, Uint8ClampedArray, Float32Array, ArrayBuffer, DataView });
  for (const name of ['redact-core', 'paint-layer', 'manual-tools', 'geometry', 'canvas-padding', 'straighten', 'perspective', 'redaction-layers', 'paint-layers']) vm.runInContext(fs.readFileSync(require.resolve('../src/' + name + '.cjs'), 'utf8'), c);
  c.dataJSON = JSON.stringify({ s: { perspective: active() }, p: collection(Paint, { perspective: active() }, selection(.08), 'hidden'), r: collection(Redact, { perspective: active() }, selection(.08), 'empty'), c: context({ perspective: active() }) });
  const result = vm.runInContext(`(() => { const v = JSON.parse(dataJSON), codes = []; for (const [api, value] of [[MintPaintLayers, v.p], [MintRedactionLayers, v.r]]) { try { api.plan(23, 18, value, v.c); throw Error('Unexpected acceptance'); } catch (e) { codes.push(e.code); } } return JSON.stringify(codes); })()`, c);
  assert.deepEqual(JSON.parse(result), ['PAINT_LAYERS_UNSUPPORTED_PERSPECTIVE_SELECTION', 'REDACTION_LAYERS_UNSUPPORTED_PERSPECTIVE_SELECTION']);
});
