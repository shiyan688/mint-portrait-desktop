'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const Native = require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
const Renderer = require('../src/paint-layer-renderer.cjs');
const Layers = require('../src/paint-layers.cjs');
const TextLayers = require('../src/text-layers.cjs');
const stroke = (o = {}) => ({ mode: 'paint', color: '#ff4010', width: .12, opacity: .8, points: [{ x: .2, y: .5 }, { x: .8, y: .5 }], ...o });
const layer = (id = 'a', o = {}) => ({ id, name: id, enabled: true, selection: null, recipe: { version: 1, strokes: [stroke()] }, ...o });
const context = (w = 80, h = 60, settings = {}) => ({ sourceRevision: 'source:1', settings, sourceSize: { width: w, height: h } });
const value = (c = context(), layers = [layer()]) => ({ version: 1, sourceRevision: c.sourceRevision, geometryKey: Layers.geometryKey(c.settings), layers });
const request = (o = {}) => ({ requestId: 'export:1', sourceRevision: 'source:1', sourceBytes: new Uint8Array([137, 80, 78, 71]), layers: value(), context: context(), width: 80, height: 60, mode: 'original', ...o });
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));
function harness(options = {}) {
  const surfaces = [], document = { createElement(tag) {
    assert.equal(tag, 'canvas'); const canvas = options.canvas ? options.canvas() : Native.createCanvas(1, 1); surfaces.push(canvas); return canvas;
  } };
  Object.defineProperty(document, 'fonts', { get() { throw Error('paint must not consult fonts'); } });
  const helper = Renderer.create({ document, crypto: options.crypto || crypto.webcrypto, layersCore: options.layersCore || Layers });
  return { helper, surfaces };
}
function disposed(canvases) { for (const c of canvases) assert.ok(c.width <= 1 && c.height <= 1, 'owned surface not released'); }
function base(w = 80, h = 60) { const c = Native.createCanvas(w, h), ctx = c.getContext('2d'); ctx.fillStyle = '#103080'; ctx.fillRect(0, 0, w, h); return c; }
function read(canvas) { return new Uint8Array(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data); }

test('frozen renderer UMD, unchanged public API and no font readiness dependency', async () => {
  assert.ok(Object.isFrozen(Renderer)); assert.deepEqual(Object.keys(harness().helper).sort(), ['raster', 'envelope', 'hashBytes', 'compositePreview'].sort());
  const sandbox = { Uint8Array, Uint8ClampedArray, ArrayBuffer, Object, TextEncoder, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/paint-layer-renderer.cjs'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.MintPaintLayerRenderer.create, 'function');
  assert.equal((await harness().helper.raster({ layers: value(), context: context(), width: 80, height: 60 })).rgba.length, 19200);
});

test('null/disabled/empty/erase-only no-op allocates and hashes nothing', async () => {
  const h = harness({ crypto: { subtle: { digest() { throw Error('hashing inactive'); } } } }), c = context();
  for (const layers of [null, value(c, []), value(c, [layer('disabled', { enabled: false })]), value(c, [layer('erase', { recipe: { version: 1, strokes: [stroke({ mode: 'erase' })] } })])]) {
    assert.equal(await h.helper.raster({ layers, context: c, width: 80, height: 60 }), null); assert.equal(await h.helper.envelope(request({ layers })), null);
  }
  const original = base(); assert.equal(h.helper.compositePreview(original, null), original); assert.equal(h.surfaces.length, 0);
});

test('dimensions, aggregate budgets, stale binding and accessors fail before surface allocation', async () => {
  const h = harness(); let getters = 0;
  for (const [width, height] of [[0, 1], [16385, 1], [4001, 4000], [1.5, 2]]) await assert.rejects(h.helper.raster({ layers: null, context: context(), width, height }));
  const invalid = request(); Object.defineProperty(invalid, 'width', { enumerable: true, get() { getters++; return 80; } }); await assert.rejects(h.helper.envelope(invalid));
  const c = context(); Object.defineProperty(c.sourceSize, 'height', { enumerable: true, get() { getters++; } }); await assert.rejects(h.helper.raster({ layers: value(), context: c, width: 80, height: 60 }));
  await assert.rejects(h.helper.envelope(request({ sourceRevision: 'source:2' })), /match context/);
  await assert.rejects(h.helper.raster({ layers: value(), context: { ...context(), settings: { eyes: 1 } }, width: 80, height: 60 }), /geometry changed/);
  const huge = context(4000, 4000), recipe = { version: 1, strokes: [stroke(), stroke({ mode: 'erase', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })] };
  await assert.rejects(h.helper.raster({ layers: value(huge, ['a', 'b', 'c'].map(id => layer(id, { recipe }))), context: huge, width: 4000, height: 4000 }), /erasure/);
  assert.equal(h.surfaces.length, 0); assert.equal(getters, 0);
});

test('snapshot context and recipes before first yield; real native multi-layer matches direct collection exactly', async () => {
  const h = harness(), c = context(), v = value(c, [layer('a'), layer('b', { recipe: { version: 1, strokes: [stroke({ color: '#0080ff', opacity: .4 }), stroke({ mode: 'erase', opacity: .5 })] } })]);
  const expected = Layers.render(80, 60, v, c, { createCanvas: Native.createCanvas });
  const pending = h.helper.raster({ layers: v, context: c, width: 80, height: 60 });
  v.layers[0].recipe.strokes[0].color = '#ffffff'; c.settings.eyes = 40; c.sourceSize.width = 1;
  const out = await pending; assert.deepEqual(out.rgba, expected.rgba); assert.ok(Object.isFrozen(out)); disposed(h.surfaces);
});

test('yield before first draw permits real queued cancellation without any allocation', async () => {
  const h = harness(), controller = new AbortController();
  const pending = h.helper.raster({ layers: value(), context: context(), width: 80, height: 60, signal: controller.signal });
  controller.abort(); await assert.rejects(pending, { name: 'AbortError', code: 'PAINT_RENDERER_ABORTED' }); assert.equal(h.surfaces.length, 0);
});

test('yield after synchronous native work rejects queued abort before publication and before next layer', async () => {
  const controller = new AbortController(); let calls = 0;
  const h = harness({ layersCore: { ...Layers, render(...args) { calls++; const result = Layers.render(...args); setTimeout(() => controller.abort(), 0); return result; } } });
  const pending = h.helper.raster({ layers: value(context(), [layer('a'), layer('b')]), context: context(), width: 80, height: 60, signal: controller.signal });
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(calls, 1); disposed(h.surfaces);
});

test('separate layers yield to event loop after surface disposal, and context cancellation is honored', async () => {
  let calls = 0, yielded = false; const h = harness({ layersCore: { ...Layers, render(...args) {
    if (calls++) { assert.equal(yielded, true); disposed(h.surfaces); }
    const result = Layers.render(...args); setTimeout(() => { yielded = true; }, 0); return result;
  } } });
  await h.helper.raster({ layers: value(context(), [layer('a'), layer('b')]), context: context(), width: 80, height: 60 }); assert.equal(calls, 2);
  await assert.rejects(h.helper.raster({ layers: value(), context: { ...context(), shouldCancel: () => true }, width: 80, height: 60 }), { name: 'AbortError' });
});

test('staleness and injected core failure dispose every factory surface without partial output', async () => {
  for (const scenario of ['throw', 'stale']) {
    let current = true;
    const h = harness({ layersCore: { ...Layers, render(w, h, v, c, options) { options.createCanvas(w, h); if (scenario === 'throw') throw Error('native failure'); current = false; return { width: w, height: h, rgba: new Uint8Array(w * h * 4) }; } } });
    await assert.rejects(h.helper.raster({ layers: value(), context: context(), width: 80, height: 60, isCurrent: () => current })); disposed(h.surfaces);
  }
});

test('hashing uses immutable actual-byte snapshots and ignores shadowed typed-array metadata', async () => {
  const done = defer(); let captured, getters = 0;
  const h = harness({ crypto: { subtle: { digest(name, bytes) { assert.equal(name, 'SHA-256'); captured = bytes; return done.promise; } } } });
  const original = new Uint8Array([9, 1, 2, 3, 8]), view = original.subarray(1, 4);
  for (const key of ['length', 'byteLength', 'buffer', 'byteOffset', Symbol.iterator]) Object.defineProperty(view, key, { get() { getters++; throw Error('getter'); } });
  const pending = h.helper.hashBytes(view); original.fill(0); assert.deepEqual([...captured], [1, 2, 3]); done.resolve(await crypto.webcrypto.subtle.digest('SHA-256', captured));
  assert.equal(await pending, sha(new Uint8Array([1, 2, 3]))); assert.equal(getters, 0);
});

test('forged, detached, shared, resizable, subclass and oversized backing buffers reject before crypto', async () => {
  let hashes = 0; const h = harness({ crypto: { subtle: { digest() { hashes++; throw Error('unexpected'); } } } });
  const detached = new Uint8Array(4); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  const oversized = new Uint8Array(Renderer.LIMITS.sourceBytes + 1);
  const bad = [Buffer.alloc(4), new Uint16Array(4), new DataView(new ArrayBuffer(4)), new Uint8Array(new SharedArrayBuffer(4)), new (class extends Uint8Array {})(4), new Proxy(new Uint8Array(4), {}), detached, oversized.subarray(0, 1)];
  if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')) bad.push(new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })));
  for (const v of bad) await assert.rejects(h.helper.hashBytes(v)); assert.equal(hashes, 0);
});

test('pending digest abort/staleness rejects promptly, consumes late rejections, and never allocates', async () => {
  for (const kind of ['abort', 'stale']) {
    const done = defer(), controller = new AbortController(); let current = true;
    const h = harness({ crypto: { subtle: { digest() { return done.promise; } } } });
    const pending = h.helper.envelope(request({ signal: controller.signal, isCurrent: () => current }));
    if (kind === 'abort') controller.abort(); else current = false;
    await assert.rejects(pending, { name: 'AbortError' }); done.reject(Error('late digest')); await nextTurn(); assert.equal(h.surfaces.length, 0);
  }
});

test('exact paint envelope binds encoded source, canonical paint recipe, revision, mode and dimensions', async () => {
  const h = harness(), input = request(), out = await h.helper.envelope(input);
  assert.deepEqual(Object.keys(out), ['version', 'requestId', 'sourceRevision', 'sourceHash', 'recipeHash', 'mode', 'width', 'height', 'rgba']);
  assert.equal(out.version, 1); assert.equal(out.sourceHash, sha(input.sourceBytes)); assert.equal(out.recipeHash, sha(Buffer.from(Layers.canonicalRecipe(input.layers))));
  assert.equal(out.sourceRevision, input.sourceRevision); assert.equal(out.mode, 'original'); assert.equal(out.width, 80); assert.equal(out.height, 60);
  assert.deepEqual(out.rgba, Layers.render(80, 60, input.layers, input.context, { createCanvas: Native.createCanvas }).rgba); disposed(h.surfaces);
});

test('prepared raster/hash pair snapshots before await and rejects hash/dimension/backing mismatch', async () => {
  const h = harness(), input = request(), raster = await h.helper.raster({ layers: input.layers, context: input.context, width: 80, height: 60 });
  const hash = sha(Buffer.from(Layers.canonicalRecipe(input.layers))), original = raster.rgba.slice(), count = h.surfaces.length;
  const pending = h.helper.envelope({ ...input, preparedRaster: raster, preparedRecipeHash: hash }); raster.rgba.fill(0);
  const out = await pending; assert.deepEqual(out.rgba, original); assert.equal(h.surfaces.length, count);
  await assert.rejects(h.helper.envelope({ ...input, preparedRaster: raster }), /together/);
  await assert.rejects(h.helper.envelope({ ...input, preparedRaster: raster, preparedRecipeHash: '0'.repeat(64) }), /hash does not match/);
  await assert.rejects(h.helper.envelope({ ...input, preparedRaster: { width: 1, height: 1, rgba: new Uint8Array(4) }, preparedRecipeHash: hash }), /dimensions/);
  const big = new Uint8Array(Renderer.LIMITS.rgbaBytes + 1);
  await assert.rejects(h.helper.envelope({ ...input, preparedRaster: { ...raster, rgba: big.subarray(0, 19200) }, preparedRecipeHash: hash }), /storage/);
});

test('same-size native preview uses exact source-over bytes without changing original source canvas', async () => {
  const h = harness(), source = base(), before = read(source), r = await h.helper.raster({ layers: value(), context: context(), width: 80, height: 60 });
  const out = h.helper.compositePreview(source, r), expected = TextLayers.composite({ width: 80, height: 60, data: before }, r).data;
  assert.notEqual(out, source); assert.deepEqual(read(source), before); assert.deepEqual(read(out), new Uint8Array(expected));
  assert.equal(out.width, 80); assert.equal(out.height, 60);
});

test('scaled preview owns scratch surfaces and cannot reuse original or previously issued output', async () => {
  const h = harness(), source = base(40, 30), before = read(source), raster = await h.helper.raster({ layers: value(), context: context(), width: 80, height: 60 });
  const out = h.helper.compositePreview(source, raster); assert.equal(out.width, 40); assert.equal(out.height, 30); assert.deepEqual(read(source), before);
  disposed(h.surfaces.filter(c => c !== out));
  const reuse = harness({ canvas: () => source }); assert.throws(() => reuse.helper.compositePreview(source, { width: 40, height: 30, rgba: new Uint8Array(4800) }), /fresh/);
  assert.equal(source.width, 40); assert.equal(source.height, 30); assert.deepEqual(read(source), before);
  const again = harness({ canvas: () => out }); assert.throws(() => again.helper.compositePreview(source, { width: 40, height: 30, rgba: new Uint8Array(4800) }), /fresh/); assert.equal(out.width, 40);
});


test('prepared overlays zero hidden RGB without changing caller storage', async () => {
  const h = harness(), c = context(1, 1), layers = value(c), bytes = new Uint8Array([9, 8, 7, 0]);
  const out = await h.helper.envelope(request({ layers, context: c, width: 1, height: 1,
    preparedRaster: { width: 1, height: 1, rgba: bytes }, preparedRecipeHash: sha(Buffer.from(Layers.canonicalRecipe(layers))) }));
  assert.deepEqual([...out.rgba], [0, 0, 0, 0]); assert.deepEqual([...bytes], [9, 8, 7, 0]); assert.equal(h.surfaces.length, 0);
});
