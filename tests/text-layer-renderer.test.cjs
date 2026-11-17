'use strict';
// Authored orchestration mocks plus optional already-installed native Skia QA.
// Native PNGs are synthetic Linux raster evidence, not browser/Windows UI QA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Renderer = require('../src/text-layer-renderer.cjs');
const Text = require('../src/text-overlay.cjs');
const Layers = require('../src/text-layers.cjs');
const layer = (id = 'title', recipe = {}, enabled = true) => ({ id, enabled, recipe: { ...Text.defaults(), text: 'Mint 薄荷', ...recipe } });
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));
function cancellation() {
  const listeners = new Set(), signal = { aborted: false, addEventListener(type, fn) { assert.equal(type, 'abort'); listeners.add(fn); }, removeEventListener(type, fn) { assert.equal(type, 'abort'); listeners.delete(fn); } };
  return { signal, listeners, abort() { signal.aborted = true; for (const listener of [...listeners]) listener(); } };
}
function harness(options = {}) {
  const created = [], draws = [], textCalls = [], reads = [], calls = { fonts: 0, hash: 0 };
  class Canvas {
    constructor() { this._width = 300; this._height = 150; this.pixels = null; this.resets = 0; this.ctx = new Context(this); }
    get width() { return this._width; } set width(value) { this._width = value; this.pixels = null; if (!value) this.resets++; }
    get height() { return this._height; } set height(value) { this._height = value; this.pixels = null; if (!value) this.resets++; }
    ensure() { if (!this.pixels) this.pixels = new Uint8ClampedArray(this.width * this.height * 4); return this.pixels; }
    getContext(type) { assert.equal(type, '2d'); if (options.noContext) return null; return this.ctx; }
  }
  class Context {
    constructor(canvas) { this.canvas = canvas; }
    createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; }
    putImageData(image) { this.canvas.ensure().set(image.data); if (options.put) options.put(this, image); }
    getImageData(x, y, width, height) { reads.push(this.canvas); if (options.read) return options.read(this, width, height); return { width, height, data: new Uint8ClampedArray(this.canvas.ensure()) }; }
    drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh) {
      assert.deepEqual([sx, sy, sw, sh, dx, dy, dw, dh], [0, 0, source.width, source.height, 0, 0, this.canvas.width, this.canvas.height]);
      draws.push({ source, target: this.canvas, smoothing: this.imageSmoothingEnabled, quality: this.imageSmoothingQuality });
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
        const si = (Math.floor(y * sh / dh) * sw + Math.floor(x * sw / dw)) * 4;
        this.canvas.ensure().set(source.ensure().subarray(si, si + 4), (y * dw + x) * 4);
      }
      if (options.draw) options.draw(this);
    }
  }
  const document = { createElement(tag) { assert.equal(tag, 'canvas'); const c = new Canvas(); created.push(c); return c; } };
  Object.defineProperty(document, 'fonts', { get() { calls.fonts++; return { ready: options.fonts || Promise.resolve(), load() { throw Error('fonts.load is forbidden'); } }; } });
  const textCore = { ...Text, render(ctx, width, height, recipe) {
    textCalls.push({ ctx, width, height, recipe });
    ctx.canvas.ensure().set([recipe.color === '#ff0000' ? 255 : 17, textCalls.length, 81, Math.round(recipe.opacity * 255)], 0);
    if (options.render) options.render(ctx, width, height, recipe);
  } };
  const crypt = { subtle: { digest(algorithm, input) { calls.hash++; return options.digest ? options.digest(algorithm, input) : crypto.webcrypto.subtle.digest(algorithm, input); } } };
  const helper = Renderer.create({ document, crypto: crypt, textCore, layersCore: options.layersCore || Layers });
  function base(width = 2, height = 2) { const c = new Canvas(); c.width = width; c.height = height; c.ensure().set([91, 31, 211, 255], 0); return c; }
  return { helper, created, draws, textCalls, reads, calls, document, textCore, base };
}
const request = overrides => ({ requestId: 'export-1', sourceRevision: 'source:1', sourceBytes: new Uint8Array([137, 80, 78, 71, 10]), layers: [layer()], width: 4, height: 3, mode: 'original', ...overrides });
const disposed = canvases => canvases.forEach(canvas => { assert.equal(canvas.width, 0); assert.equal(canvas.height, 0); assert.ok(canvas.resets >= 2); });

test('renderer exposes a frozen UMD browser API with no imports or font/network actions', () => {
  const sandbox = { Uint8Array, Uint8ClampedArray, ArrayBuffer, Object, TextEncoder, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/text-layer-renderer.cjs'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.MintTextLayerRenderer.create, 'function');
  assert.ok(Object.isFrozen(Renderer)); assert.ok(Object.isFrozen(Renderer.LIMITS));
  assert.deepEqual(Renderer.LIMITS, { pixels: 16000000, edge: 16384, rgbaBytes: 64000000, sourceBytes: 83886080 });
});

test('inactive text is exact no-op: no Canvas, font wait, hashing, or base readback', async () => {
  const h = harness({ fonts: new Promise(() => {}) }), base = h.base(), original = new Uint8ClampedArray(base.ensure());
  for (const layers of [[], [layer('disabled', {}, false)], [layer('empty', { text: '' })], [layer('transparent', { opacity: 0 })]]) {
    assert.equal(await h.helper.raster({ layers, width: 4, height: 3 }), null);
    assert.equal(await h.helper.envelope(request({ layers })), null);
  }
  assert.equal(h.helper.compositePreview(base, null), base);
  assert.equal(h.created.length, 0); assert.equal(h.reads.length, 0); assert.equal(h.calls.fonts, 0); assert.equal(h.calls.hash, 0);
  assert.deepEqual(base.ensure(), original);
});

test('all invalid bounds fail before any Canvas or font allocation, including disabled text', async () => {
  const h = harness();
  for (const [width, height] of [[0, 1], [1, -1], [1.2, 1], [1, NaN], [Infinity, 2], [16385, 1], [1, 16385], [4001, 4000], ['2', 2], [Number.MAX_SAFE_INTEGER, 1]]) {
    await assert.rejects(h.helper.raster({ layers: [], width, height }));
    await assert.rejects(h.helper.envelope(request({ width, height })));
  }
  // Exact boundaries can be checked without allocating large buffers.
  assert.equal(await h.helper.raster({ layers: [], width: 4000, height: 4000 }), null);
  assert.equal(await h.helper.raster({ layers: [], width: 16384, height: 1 }), null);
  assert.equal(h.created.length, 0); assert.equal(h.calls.fonts, 0);
});

test('render waits existing font readiness, snapshots layers, paints order onto ONE disposable full-size canvas', async () => {
  const ready = defer(), h = harness({ fonts: ready.promise });
  const layers = [layer('a'), layer('disabled', {}, false), layer('empty', { text: '' }), layer('b', { color: '#ff0000', opacity: .4 })];
  const before = JSON.stringify(layers), pending = h.helper.raster({ layers, width: 40, height: 30 });
  layers[0].recipe.text = 'mutated after request';
  await nextTurn(); assert.equal(h.created.length, 0); ready.resolve();
  const result = await pending;
  assert.equal(h.created.length, 1); assert.equal(h.textCalls.length, 2);
  assert.deepEqual(h.textCalls.map(call => [call.width, call.height, call.recipe.text]), [[40, 30, 'Mint 薄荷'], [40, 30, 'Mint 薄荷']]);
  assert.equal(h.textCalls[0].ctx, h.textCalls[1].ctx);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(h.textCalls[0].recipe));
  assert.equal(result.rgba.length, 40 * 30 * 4); assert.deepEqual([...result.rgba.subarray(0, 4)], [255, 2, 81, 102]);
  assert.notEqual(JSON.stringify(layers), before); assert.equal(layers[1].enabled, false);
  disposed(h.created);
});

test('malformed layers/options reject before allocation and accessors never execute', async () => {
  const h = harness(); let hooks = 0;
  for (const input of [null, { layers: [layer()], width: 2, height: 2, unexpected: true }, { layers: [layer()], width: 2, height: 2, isCurrent: true }, { layers: [layer()], width: 2, height: 2, signal: {} }, { layers: [layer(), layer()], width: 2, height: 2 }]) await assert.rejects(h.helper.raster(input));
  const forged = { layers: [layer()], width: 2, height: 2 };
  Object.defineProperty(forged, 'width', { enumerable: true, get() { hooks++; return 2; } });
  await assert.rejects(h.helper.raster(forged)); assert.equal(hooks, 0); assert.equal(h.created.length, 0);
});

test('aborted pending fonts reject promptly, release listeners, consume late rejection, and never allocate', async () => {
  const ready = defer(), cancel = cancellation(), h = harness({ fonts: ready.promise });
  const pending = h.helper.raster({ layers: [layer()], width: 2, height: 2, signal: cancel.signal });
  assert.equal(cancel.listeners.size, 1); cancel.abort();
  await assert.rejects(pending, error => error.name === 'AbortError' && error.code === 'TEXT_RENDERER_ABORTED');
  assert.equal(cancel.listeners.size, 0); assert.equal(h.created.length, 0);
  ready.reject(Error('late font failure')); await nextTurn();
});

test('stale pending fonts reject even without AbortSignal or fonts settlement', async () => {
  let current = true; const h = harness({ fonts: new Promise(() => {}) });
  const pending = h.helper.raster({ layers: [layer()], width: 2, height: 2, isCurrent: () => current });
  current = false;
  await assert.rejects(pending, error => error.name === 'AbortError' && error.code === 'TEXT_RENDERER_STALE');
  assert.equal(h.created.length, 0);
});

test('fonts rejection, pre-abort and pre-staleness never allocate or publish', async () => {
  const rejected = Promise.reject(Error('font readiness failed')); const h = harness({ fonts: rejected });
  await assert.rejects(h.helper.raster({ layers: [layer()], width: 2, height: 2 }), /font readiness failed/);
  const cancel = cancellation(); cancel.abort();
  await assert.rejects(h.helper.raster({ layers: [layer()], width: 2, height: 2, signal: cancel.signal }), { name: 'AbortError' });
  await assert.rejects(h.helper.raster({ layers: [layer()], width: 2, height: 2, isCurrent: () => false }), { name: 'AbortError' });
  assert.equal(h.created.length, 0); assert.equal(cancel.listeners.size, 0);
});

test('render failure, cancellation between layers, stale readback and context failure dispose without partial output', async () => {
  const scenarios = [
    () => ({ render() { throw Error('native draw failed'); } }),
    cancel => ({ render() { cancel.abort(); } }),
    (cancel, state) => ({ render() { state.current = false; } }),
    (cancel, state) => ({ read(ctx, width, height) { state.current = false; return { width, height, data: new Uint8ClampedArray(width * height * 4) }; } }),
    () => ({ noContext: true }),
    () => ({ read(ctx, width, height) { return { width, height, data: new Uint8Array(1) }; } })
  ];
  for (const scenario of scenarios) {
    const cancel = cancellation(), state = { current: true }, h = harness(scenario(cancel, state));
    await assert.rejects(h.helper.raster({ layers: [layer('a'), layer('b')], width: 2, height: 2, signal: cancel.signal, isCurrent: () => state.current }));
    assert.equal(cancel.listeners.size, 0); disposed(h.created);
    if (!state.current || cancel.signal.aborted) assert.ok(h.textCalls.length <= 2);
  }
});

test('hashBytes hashes immutable snapshots and honors offsets without calling shadow metadata', async () => {
  let captured; const done = defer();
  const h = harness({ digest(algorithm, bytes) { assert.equal(algorithm, 'SHA-256'); captured = bytes; return done.promise; } });
  const original = new Uint8Array([99, 1, 2, 3, 88]), value = original.subarray(1, 4); let hooks = 0;
  for (const key of ['length', 'byteLength', 'byteOffset', 'buffer', Symbol.iterator]) Object.defineProperty(value, key, { get() { hooks++; throw Error('getter'); } });
  const pending = h.helper.hashBytes(value); original.fill(0); assert.deepEqual([...captured], [1, 2, 3]);
  done.resolve(await crypto.webcrypto.subtle.digest('SHA-256', captured));
  assert.equal(await pending, sha(new Uint8Array([1, 2, 3]))); assert.equal(hooks, 0);
  const regular = harness(); assert.equal(await regular.helper.hashBytes(new ArrayBuffer(0)), sha(new Uint8Array(0)));
});

test('hash input rejects fabricated, shared, detached, oversized backing and resizable byte storage before crypto', async () => {
  const h = harness(), invalid = [[1, 2], new Uint16Array(2), new DataView(new ArrayBuffer(4)), new (class extends Uint8Array {})(4), new Uint8Array(new SharedArrayBuffer(4)), new Proxy(new Uint8Array(4), {})];
  const detached = new Uint8Array(4); structuredClone(detached.buffer, { transfer: [detached.buffer] }); invalid.push(detached);
  const large = new Uint8Array(Renderer.LIMITS.sourceBytes + 1); invalid.push(large.subarray(0, 1));
  if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')) invalid.push(new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })));
  for (const value of invalid) await assert.rejects(h.helper.hashBytes(value));
  assert.equal(h.calls.hash, 0);
});

test('cancelled hashing rejects promptly and cannot publish late digest results', async () => {
  const done = defer(), cancel = cancellation(), h = harness({ digest() { return done.promise; } });
  const pending = h.helper.envelope(request({ signal: cancel.signal })); cancel.abort();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(cancel.listeners.size, 0); assert.equal(h.created.length, 0);
  done.resolve(new ArrayBuffer(32)); await nextTurn(); assert.equal(h.created.length, 0);
});

test('synchronous host cancellation plus rejected promise is consumed, and explicit undefined controls are optional', async () => {
  const cancel = cancellation(), h = harness({ digest() { cancel.abort(); return Promise.reject(Error('late digest error')); } });
  await assert.rejects(h.helper.hashBytes(new Uint8Array([1]), { signal: cancel.signal }), { name: 'AbortError' });
  await nextTurn(); assert.equal(cancel.listeners.size, 0);
  const other = harness();
  const r = await other.helper.raster({ layers: [layer()], width: 2, height: 2, signal: undefined, isCurrent: undefined });
  assert.equal(r.rgba.length, 16); disposed(other.created);
});

test('envelope exact v1 association hashes original encoded bytes and canonical recipe, not PNG or preview', async () => {
  const h = harness(), input = request(), sourceBefore = new Uint8Array(input.sourceBytes), recipeBefore = JSON.stringify(input.layers);
  const result = await h.helper.envelope(input);
  assert.deepEqual(Object.keys(result), ['version', 'requestId', 'sourceRevision', 'sourceHash', 'recipeHash', 'mode', 'width', 'height', 'rgba']);
  assert.equal(result.version, 1); assert.equal(result.sourceHash, sha(sourceBefore));
  assert.equal(result.recipeHash, sha(Buffer.from(Layers.canonicalRecipe(input.layers), 'utf8')));
  assert.equal(result.mode, 'original'); assert.equal(result.rgba.length, 48); assert.ok(Object.isFrozen(result));
  assert.deepEqual(input.sourceBytes, sourceBefore); assert.equal(JSON.stringify(input.layers), recipeBefore); disposed(h.created);
  for (const changed of [request({ requestId: '../path' }), request({ sourceRevision: 1 }), request({ sourceRevision: 'constructor' }), request({ mode: 'auto' }), request({ sourceBytes: new Uint8Array(0) })]) await assert.rejects(h.helper.envelope(changed));
});

test('prepared raster reuse takes owned copies, validates recipe association and never remeasures', async () => {
  const h = harness(), input = request(), prepared = { width: 4, height: 3, rgba: new Uint8Array(48).fill(73) };
  const recipeHash = sha(Buffer.from(Layers.canonicalRecipe(input.layers), 'utf8'));
  const pending = h.helper.envelope({ ...input, preparedRaster: prepared, preparedRecipeHash: recipeHash }); prepared.rgba.fill(9);
  const result = await pending; assert.equal(result.rgba[0], 73); assert.notEqual(result.rgba, prepared.rgba);
  assert.equal(h.created.length, 0); assert.equal(h.calls.fonts, 0); assert.equal(h.textCalls.length, 0);
  for (const extra of [{ preparedRaster: prepared }, { preparedRecipeHash: recipeHash }, { preparedRaster: prepared, preparedRecipeHash: '0'.repeat(64) }, { preparedRaster: { ...prepared, width: 3 }, preparedRecipeHash: recipeHash }, { preparedRaster: { ...prepared, rgba: new Uint8Array(47) }, preparedRecipeHash: recipeHash }]) await assert.rejects(h.helper.envelope({ ...input, ...extra }));
  assert.equal(h.created.length, 0);
});

test('preview downsamples full-size pixels, uses high quality source-over, and never changes accepted base', async () => {
  const h = harness(), r = await h.helper.raster({ layers: [layer()], width: 4, height: 4 });
  const base = h.base(), original = new Uint8ClampedArray(base.ensure()), overlay = new Uint8Array(r.rgba);
  const result = h.helper.compositePreview(base, r);
  assert.notEqual(result, base); assert.equal(result.width, 2); assert.equal(result.height, 2);
  assert.equal(h.textCalls.length, 1); assert.deepEqual(h.draws.map(d => [d.smoothing, d.quality]), [[true, 'high']]);
  assert.deepEqual(base.ensure(), original); assert.deepEqual(r.rgba, overlay);
  assert.equal(h.created.length, 4); disposed(h.created.slice(0, -1));
  assert.deepEqual([...result.ensure().subarray(0, 4)], [17, 1, 81, 255]);
});

test('same-size preview composites exact owned RGBA without a Canvas overlay roundtrip', () => {
  const h = harness(), base = h.base(), raster = { width: 2, height: 2, rgba: new Uint8Array([255, 17, 31, 1, 11, 99, 27, 35, 18, 91, 71, 128, 255, 31, 19, 254]) };
  const original = new Uint8ClampedArray(base.ensure()), overlay = new Uint8Array(raster.rgba);
  const expected = Layers.composite({ width: 2, height: 2, data: original }, raster).data;
  const result = h.helper.compositePreview(base, raster);
  assert.deepEqual(result.ensure(), expected); assert.deepEqual(base.ensure(), original); assert.deepEqual(raster.rgba, overlay);
  assert.equal(h.created.length, 1, 'Only the final output Canvas is allocated'); assert.equal(h.created[0], result);
  assert.equal(h.draws.length, 0); assert.equal(h.reads.length, 1); assert.equal(h.reads[0], base);
});

test('same-size preview abort during final write disposes output and cannot publish', () => {
  const cancel = cancellation(), h = harness({ put() { cancel.abort(); } }), base = h.base();
  const original = new Uint8ClampedArray(base.ensure()), raster = { width: 2, height: 2, rgba: new Uint8Array(16).fill(35) };
  assert.throws(() => h.helper.compositePreview(base, raster, { signal: cancel.signal }), { name: 'AbortError' });
  assert.equal(h.created.length, 1); disposed(h.created); assert.deepEqual(base.ensure(), original); assert.equal(h.draws.length, 0);
});

test('preview validates raw buffers before allocation and base dimensions even for a null overlay', () => {
  const h = harness(), base = h.base(), valid = { width: 2, height: 2, rgba: new Uint8Array(16) };
  const big = new Uint8Array(Renderer.LIMITS.rgbaBytes + 1);
  const invalid = [{ ...valid, extra: 1 }, { ...valid, width: 0 }, { ...valid, rgba: new Uint8Array(15) }, { ...valid, rgba: new Uint8Array(new SharedArrayBuffer(16)) }, { ...valid, rgba: big.subarray(0, 16) }];
  if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')) invalid.push({ ...valid, rgba: new Uint8Array(new ArrayBuffer(16, { maxByteLength: 32 })) });
  for (const r of invalid) assert.throws(() => h.helper.compositePreview(base, r));
  base.width = 16385; assert.throws(() => h.helper.compositePreview(base, null)); assert.equal(h.created.length, 0);
});

test('preview cancellation during downsampling or final write frees every owned Canvas, keeps base untouched', () => {
  for (const finalWrite of [false, true]) {
    const cancel = cancellation(); let puts = 0;
    const h = harness({ draw() { if (!finalWrite) cancel.abort(); }, put() { if (++puts === 2 && finalWrite) cancel.abort(); } });
    const base = h.base(), before = new Uint8ClampedArray(base.ensure()), raster = { width: 4, height: 4, rgba: new Uint8Array(64).fill(100) };
    assert.throws(() => h.helper.compositePreview(base, raster, { signal: cancel.signal }), { name: 'AbortError' });
    disposed(h.created); assert.deepEqual(base.ensure(), before); assert.equal(base.width, 2);
  }
});

test('preview source-over receives a cancellable independent base and overlay snapshot', () => {
  let called = false, current = true;
  const h = harness({ layersCore: { ...Layers, composite(base, raster, options) {
    called = true; assert.equal(options.shouldCancel(), false); base.data.fill(123); raster.rgba.fill(99);
    current = false; assert.throws(options.shouldCancel, { name: 'AbortError' });
    return { width: base.width, height: base.height, data: base.data };
  } } });
  const base = h.base(), before = new Uint8ClampedArray(base.ensure()), raster = { width: 2, height: 2, rgba: new Uint8Array(16).fill(70) };
  assert.throws(() => h.helper.compositePreview(base, raster, { isCurrent: () => current }), { name: 'AbortError' });
  assert.ok(called); assert.deepEqual(base.ensure(), before); assert.equal(raster.rgba[0], 70); disposed(h.created);
});

// No installation or browser/socket process is attempted. This native package
// is optional QA infrastructure and never a production dependency.
let Native;
const nativePath = '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas';
try { if (fs.existsSync(path.join(nativePath, 'package.json'))) Native = require(nativePath); } catch (_) { /* Explicit test skip below. */ }
function nativeBrowserCanvas(width, height) {
  const canvas = Native.createCanvas(width, height), ctx = canvas.getContext('2d'), read = ctx.getImageData.bind(ctx);
  // This installed Skia build accepts a color-space STRING as argument five,
  // despite browser Canvas using an options object. Adapt only that signature;
  // measurements, drawing, scaling, pixels and encoding are all native calls.
  ctx.getImageData = (x, y, w, h, settings) => read(x, y, w, h, settings && typeof settings === 'object' ? settings.colorSpace : settings);
  return canvas;
}
function nativeDocument() { return { fonts: { ready: Promise.resolve() }, createElement(tag) { assert.equal(tag, 'canvas'); return nativeBrowserCanvas(1, 1); } }; }
function nativePixels(canvas) { return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; }
function equalNative(actual, expected, label) {
  assert.equal(actual.length, expected.length, label + ' byte length');
  let differences = 0, first = null, maximum = 0;
  for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i]) {
    differences++; maximum = Math.max(maximum, Math.abs(actual[i] - expected[i]));
    if (first === null) first = { index: i, actual: actual[i], expected: expected[i] };
  }
  // Keep failures bounded rather than pretty-printing megabytes of RGBA bytes.
  assert.equal(differences, 0, label + ': ' + JSON.stringify({ differences, maximum, first }));
}
function rawCanvas(width, height, data) { const canvas = Native.createCanvas(width, height), ctx = canvas.getContext('2d'), image = ctx.createImageData(width, height); image.data.set(data); ctx.putImageData(image, 0, 0); return canvas; }
function sourceOverOracle(base, top) {
  const out = new Uint8ClampedArray(base);
  for (let i = 0; i < base.length; i += 4) {
    const sourceAlpha = top[i + 3] / 255, destAlpha = base[i + 3] / 255, alpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
    if (sourceAlpha === 0) continue;
    for (let c = 0; c < 3; c++) out[i + c] = Math.round((top[i + c] * sourceAlpha + base[i + c] * destAlpha * (1 - sourceAlpha)) / alpha);
    out[i + 3] = Math.round(alpha * 255);
  }
  return out;
}

test('native Skia actual Latin/CJK multilayer PNGs: renderer equals direct shared-core raster and exact same-basis preview', { skip: !Native && 'Already-installed native Canvas is unavailable; no download attempted' }, async t => {
  const registrations = [];
  for (const [file, family] of [['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'sans-serif'], ['/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 'sans-serif'], ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 'monospace']]) {
    if (fs.existsSync(file)) { assert.ok(Native.GlobalFonts.registerFromPath(file, family)); registrations.push({ file, family, sha256: sha(fs.readFileSync(file)) }); }
  }
  assert.ok(registrations.some(r => r.file.includes('CJK')), 'Native CJK evidence requires an existing CJK font; never download one');
  const document = nativeDocument(), helper = Renderer.create({ document, crypto: crypto.webcrypto, textCore: Text, layersCore: Layers });
  const width = 960, height = 640;
  const layers = [
    layer('headline', { text: 'Mint Portrait 薄荷人像\nCanvas 文字：同一栅格', size: .092, x: .5, y: .26, boxWidth: .82, color: '#eafff2', outlineWidth: .075, outlineColor: '#052b24', shadow: true }),
    layer('rotated', { text: '旋转 Rotation\nopacity 62%', x: .34, y: .64, size: .12, boxWidth: .54, rotation: -17, color: '#fc758f', outlineWidth: .04, opacity: .62, shadow: true }),
    layer('top', { text: 'TOP / 最上层', x: .60, y: .66, size: .10, rotation: 14, color: '#6cf5d2', outlineWidth: .025, outlineColor: '#103950', opacity: .82 }),
    layer('disabled', { text: 'MUST NOT RENDER' }, false)
  ];
  const original = JSON.stringify(layers), raster = await helper.raster({ layers, width, height });
  const direct = Native.createCanvas(width, height), ctx = direct.getContext('2d');
  for (const item of layers) if (item.enabled && Text.isActive(item.recipe)) Text.render(ctx, width, height, item.recipe);
  equalNative(raster.rgba, nativePixels(direct), 'direct shared-core raster'); assert.equal(JSON.stringify(layers), original);
  assert.ok(raster.rgba.some((v, i) => i % 4 === 3 && v > 0 && v < 255), 'Outline/shadow/opacity edges are actual semi-transparent pixels');
  const reversed = await helper.raster({ layers: [...layers].reverse(), width, height });
  assert.notEqual(sha(raster.rgba), sha(reversed.rgba), 'Overlapping layer order affects pixels');
  const changed = await helper.raster({ layers: layers.map(item => ({ ...item, recipe: { ...item.recipe, outlineWidth: 0, shadow: false, opacity: 1, rotation: 0 } })), width, height });
  assert.notEqual(sha(raster.rgba), sha(changed.rgba), 'Styling is not ignored');
  const previewWidth = 333, previewHeight = 222, base = nativeBrowserCanvas(previewWidth, previewHeight), bctx = base.getContext('2d');
  const gradient = bctx.createLinearGradient(0, 0, previewWidth, previewHeight); gradient.addColorStop(0, '#123b46'); gradient.addColorStop(1, '#07191f'); bctx.fillStyle = gradient; bctx.fillRect(0, 0, previewWidth, previewHeight);
  const baseBefore = new Uint8ClampedArray(nativePixels(base)), preview = helper.compositePreview(base, raster);
  equalNative(nativePixels(base), baseBefore, 'immutable base'); assert.notEqual(preview, base);
  const scaled = Native.createCanvas(previewWidth, previewHeight), sctx = scaled.getContext('2d');
  sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high'; sctx.drawImage(direct, 0, 0, width, height, 0, 0, previewWidth, previewHeight);
  const oracle = sourceOverOracle(baseBefore, nativePixels(scaled));
  const expected = rawCanvas(previewWidth, previewHeight, oracle);
  equalNative(nativePixels(preview), nativePixels(expected), 'scaled source-over oracle');
  const transparentBase = nativeBrowserCanvas(width, height), fullComposite = helper.compositePreview(transparentBase, raster);
  // At equal dimensions, the exact final-export bytes enter Layers.composite
  // directly; there must be no overlay Canvas premultiplication/scale roundtrip.
  const fullRaw = Layers.composite({ width, height, data: new Uint8ClampedArray(width * height * 4) }, raster).data;
  const fullExpected = rawCanvas(width, height, fullRaw);
  equalNative(nativePixels(fullComposite), nativePixels(fullExpected), 'same-size exact Layers compositor');
  const encodedSource = new Uint8Array(base.toBuffer('image/png'));
  const envelope = await helper.envelope({ ...request(), sourceBytes: encodedSource, layers, width, height,
    preparedRaster: raster, preparedRecipeHash: sha(Buffer.from(Layers.canonicalRecipe(layers), 'utf8')) });
  equalNative(envelope.rgba, raster.rgba, 'prepared export pixels'); assert.equal(envelope.sourceHash, sha(encodedSource));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-text-raster-native-'));
  const images = { 'full-overlay.png': direct, 'same-basis-preview.png': preview, 'reversed-order.png': rawCanvas(width, height, reversed.rgba), 'full-composite.png': fullComposite };
  const evidence = {};
  for (const [name, canvas] of Object.entries(images)) { const png = canvas.toBuffer('image/png'); fs.writeFileSync(path.join(dir, name), png); evidence[name] = { sha256: sha(png), width: canvas.width, height: canvas.height, bytes: png.length }; }
  const report = { qualification: 'Synthetic native Linux Skia raster evidence only; not Electron, browser, Windows, installer, cross-OS font acceptance, or a private photo.', nativeVersion: require(path.join(nativePath, 'package.json')).version, fonts: registrations, width, height, previewWidth, previewHeight, sourceHash: envelope.sourceHash, recipeHash: envelope.recipeHash, rgbaHash: sha(raster.rgba), images: evidence, assertions: ['shared core equals renderer pixels', 'CJK/Latin/multiline/outline/shadow/opacity/rotation/order exercised', 'smaller preview uses exact full-size raster downsample', 'same-size preview equals exact raw Layers compositor without overlay Canvas roundtrip', 'independent source-over oracle matches real scaled preview readback', 'source unchanged', 'exact envelope association'] };
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
  t.diagnostic('Native PNG evidence: ' + dir);
});

test('native Skia interrupted real drawing cannot publish partial raster or envelope', { skip: !Native && 'Already-installed native Canvas is unavailable; no download attempted' }, async () => {
  for (const stale of [false, true]) {
    const cancel = cancellation(); let current = true, draws = 0, paintedPixels = 0;
    const textCore = { ...Text, render(ctx, width, height, recipe) {
      Text.render(ctx, width, height, recipe); draws++;
      const raw = ctx.getImageData(0, 0, width, height).data;
      paintedPixels = raw.reduce((count, value, i) => count + (i % 4 === 3 && value > 0 ? 1 : 0), 0);
      if (stale) current = false; else cancel.abort();
    } };
    const helper = Renderer.create({ document: nativeDocument(), crypto: crypto.webcrypto, textCore, layersCore: Layers });
    let published = false;
    const pending = helper.envelope(request({ layers: [layer('first', { text: 'Real Canvas', size: .25 }), layer('second')], width: 240, height: 160, signal: cancel.signal, isCurrent: () => current })).then(value => { published = true; return value; });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(draws, 1); assert.ok(paintedPixels > 0); assert.equal(published, false); assert.equal(cancel.listeners.size, 0);
  }
});
