'use strict';
// Independent offline QA: separate coordinate/RGBA oracles and real shipped app
// handlers in an authored DOM/canvas/IPC environment. Native Skia/Sharp evidence,
// when enabled, is synthetic raster evidence, NOT an app/browser screenshot.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const I = require('../src/preview-pixel-inspector.cjs');
const G = require('../src/geometry.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const rect = (left, top, width, height) => ({ left, top, width, height });
const image = (width, height, values) => ({ width, height, data: new Uint8ClampedArray(values || width * height * 4) });
function mapOracle(p, im, view, size) {
  if (p.x < view.left || p.y < view.top || p.x >= view.left + view.width || p.y >= view.top + view.height ||
      p.x < im.left || p.y < im.top || p.x >= im.left + im.width || p.y >= im.top + im.height) return null;
  return { x: Math.floor((p.x - im.left) * size.width / im.width), y: Math.floor((p.y - im.top) * size.height / im.height) };
}
function sampleOracle(im, x, y) {
  const i = (y * im.width + x) * 4, a = im.data[i + 3], values = [im.data[i], im.data[i + 1], im.data[i + 2]];
  return { x, y, r: a ? values[0] : null, g: a ? values[1] : null, b: a ? values[2] : null, a,
    alphaMode: a === 0 ? 'transparent' : a === 255 ? 'opaque' : 'partial',
    zeroChannels: a ? ['R', 'G', 'B'].filter((_, j) => values[j] === 0) : [],
    fullChannels: a ? ['R', 'G', 'B'].filter((_, j) => values[j] === 255) : [] };
}

test('independent pixel core: exact allocation ceiling accepts 1280 square and rejects overflow without allocating', () => {
  assert.deepEqual(I.LIMITS, { maxEdge: 1280, maxBytes: 6553600 });
  for (const [width, height] of [[1, 1], [1280, 1280], [1280, 1], [1, 1280], [1279, 769]]) {
    const s = I.boundedSize(width, height); assert.equal(s.width, width); assert.equal(s.height, height); assert.equal(s.bytes, width * height * 4);
  }
  for (const [w, h] of [[0, 1], [-1, 1], [1.5, 1], [1281, 1], [1, 1281], [Infinity, 1], [1, NaN], [1, '1'], [null, 1], [Number.MAX_SAFE_INTEGER, 1]]) assert.throws(() => I.boundedSize(w, h));
});

test('independent pixel mapping: image and viewport are both half-open, including panned visible intersections', () => {
  const size = { width: 100, height: 80 };
  for (const im of [rect(25, 30, 500, 400), rect(-340, -150, 1000, 800), rect(600, 500, 500, 400), rect(0, 0, .001, .0008)]) {
    const view = rect(0, 0, 800, 600);
    for (const x of [im.left - .001, im.left, im.left + im.width - .00001, im.left + im.width, view.left - .001, view.left, view.left + view.width - .00001, view.left + view.width]) {
      for (const y of [im.top - .001, im.top, im.top + im.height - .00001, im.top + im.height, view.top, view.top + view.height - .00001, view.top + view.height]) {
        const p = { x, y }; assert.deepEqual(I.mapPoint(p, im, view, size), mapOracle(p, im, view, size));
      }
    }
  }
  assert.equal(I.mapPoint({ x: 12, y: 12 }, rect(0, 0, 20, 20), rect(20, 20, 50, 50), size), null);
});

test('independent pixel mapping: deterministic non-boundary oracle covers fractional zoom, pan and portrait/landscape dimensions', () => {
  let seed = 0x721692ab; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < 5000; i++) {
    const size = { width: 1 + Math.floor(random() * 1280), height: 1 + Math.floor(random() * 1280) };
    const im = rect(random() * 1200 - 600, random() * 1000 - 500, .05 + random() * 5000, .05 + random() * 5000);
    const view = rect(random() * 100 - 50, random() * 100 - 50, 200 + random() * 1000, 150 + random() * 800);
    const p = { x: random() * 1800 - 500, y: random() * 1400 - 500 }, before = JSON.stringify({ p, im, view, size });
    assert.deepEqual(I.mapPoint(p, im, view, size), mapOracle(p, im, view, size));
    assert.equal(JSON.stringify({ p, im, view, size }), before);
  }
});

test('independent pixel core: all alpha values distinguish invisible hidden RGB, uncomposited partial RGB and byte endpoints', () => {
  const im = image(256, 4);
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) im.data.set([[0, 128, 255, x], [255, 0, 255, x], [17, 93, 212, x], [0, 0, 0, x]][y], (y * im.width + x) * 4);
  const before = hash(im.data);
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) assert.deepEqual(I.samplePixel(im, x, y), sampleOracle(im, x, y));
  assert.equal(hash(im.data), before);
  assert.deepEqual(I.samplePixel(image(1, 1, [0, 255, 77, 1]), 0, 0), { x: 0, y: 0, r: 0, g: 255, b: 77, a: 1, alphaMode: 'partial', zeroChannels: ['R'], fullChannels: ['G'] });
});

test('independent pixel core: subarray byte offsets are honored with no data copy or mutation', () => {
  const data = new Uint8Array([255, 255, 255, 255, 0, 255, 19, 128, 90, 0, 255, 255, 1, 2, 3, 4]);
  const im = { width: 2, height: 1, data: data.subarray(4, 12) }, before = hash(data);
  assert.deepEqual(I.samplePixel(im, 0, 0), sampleOracle(im, 0, 0)); assert.deepEqual(I.samplePixel(im, 1, 0), sampleOracle(im, 1, 0)); assert.equal(hash(data), before);
});

test('independent pixel core: intrinsic typed-array accessors avoid attacker-controlled shadows', () => {
  const data = new Uint8ClampedArray([0, 255, 31, 127]); let hooks = 0;
  for (const field of ['buffer', 'length', 'byteLength', 'byteOffset', 'slice', 'subarray', Symbol.iterator]) Object.defineProperty(data, field, { get() { hooks++; throw new Error('must not call shadow'); } });
  const sampled = I.samplePixel({ width: 1, height: 1, data }, 0, 0);
  assert.deepEqual(sampled, { x: 0, y: 0, r: 0, g: 255, b: 31, a: 127, alphaMode: 'partial', zeroChannels: ['R'], fullChannels: ['G'] }); assert.equal(hooks, 0);
});

test('independent pixel core: foreign storage, subclasses, shared and detached data fail closed', () => {
  for (const data of [[1, 2, 3, 4], new Uint16Array(4), new Float32Array(4), new DataView(new ArrayBuffer(4)), new Uint8Array(3), new Uint8Array(5), new (class extends Uint8Array {})(4), new Uint8Array(new SharedArrayBuffer(4))]) assert.throws(() => I.samplePixel({ width: 1, height: 1, data }, 0, 0));
  const im = image(1, 1, [0, 255, 88, 255]); structuredClone(im.data.buffer, { transfer: [im.data.buffer] }); assert.throws(() => I.samplePixel(im, 0, 0));
});

test('independent pixel core: malformed coordinates and own-field accessors never coerce or execute', () => {
  let hooks = 0; const im = image(2, 2), p = { x: 0, y: 0 }, r = rect(0, 0, 2, 2), s = { width: 2, height: 2 };
  for (const [x, y] of [[-1, 0], [2, 0], [0, 2], [.5, 0], [0, Infinity], [NaN, 0], ['0', 0], [null, 0], [{ valueOf() { hooks++; return 0; } }, 0]]) assert.throws(() => I.samplePixel(im, x, y));
  for (const [input, key, run] of [[im, 'data', a => I.samplePixel(a, 0, 0)], [p, 'x', a => I.mapPoint(a, r, r, s)], [r, 'left', a => I.mapPoint(p, a, r, s)], [s, 'width', a => I.mapPoint(p, r, r, a)]]) {
    const forged = { ...input }; Object.defineProperty(forged, key, { enumerable: true, get() { hooks++; return input[key]; } }); assert.throws(() => run(forged));
    assert.throws(() => run(Object.create(input)));
    assert.throws(() => run({ ...input, unexpected: true }));
  }
  assert.equal(hooks, 0);
});

// Reuse infrastructure only. The owner's inspector assertions are never loaded.
let environment;
function infrastructure() {
  if (!environment) {
    let text = fs.readFileSync(require.resolve('./photo-review-ui.test.cjs'), 'utf8');
    const end = text.indexOf("test('photo review UI:"); assert.ok(end > 0); text = text.slice(0, end);
    text = text.replace('  let app=fs.readFileSync', `  for (const [file, name] of [['reference-compare.cjs','MintReferenceCompare'],['preview-pixel-inspector.cjs','MintPreviewPixelInspector']]) { vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/',file),'utf8'),context); context.window[name]=context[name]; }\n  let app=fs.readFileSync`)
      .replace('setTimeout:(fn,delay)=>{if(delay===0)queueMicrotask(fn);return ++timer;},clearTimeout(){}', 'setTimeout:(fn,delay)=>{const id=++timer;(calls.timers||(calls.timers=new Map())).set(id,{fn,delay});if(delay===0&&!overrides.controlTimers)queueMicrotask(()=>{if(calls.timers.has(id)){calls.timers.delete(id);fn();}});return id;},clearTimeout:id=>calls.timers?.delete(id)');
    environment = new Function('require', '__dirname', text + '\nreturn {ready,flush,defer,until,key,realm,png,snapshot};')(require, __dirname);
  }
  return environment;
}
async function ui(options = {}) {
  const h = await infrastructure().ready({ controlTimers: true, ...options });
  h.inspect = vm.runInContext(`({previewPixelReason,clearPreviewPixelInspector,syncPreviewPixelInspector,refreshPreviewPixelReadout,rememberPreviewPixelPointer,freshAcceptedRender,scheduleRender,pinReference,clearReference,setReferenceCompare,clearSessionView,
    get:()=>({previewPixelEnabled,previewPixelCache,previewPixelPointer,previewPixelFailedRender,acceptedRender,renderPending,renderFailure,renderVersion,renderingPhoto,renderTimer}),
    set:value=>{if('renderVersion'in value)renderVersion=value.renderVersion;if('renderPending'in value)renderPending=value.renderPending;if('renderFailure'in value)renderFailure=value.renderFailure;if('rendered'in value)rendered=value.rendered;if('tool'in value)tool=value.tool;if('openingDialog'in value)openingDialog=value.openingDialog;if('projectOperation'in value)projectOperation=value.projectOperation;if('zoom'in value)zoom=value.zoom;if('panX'in value)panX=value.panX;if('panY'in value)panY=value.panY;}})`, h.context);
  h.activate();
  const source = h.api.get().source; source.pixels = new Uint8ClampedArray(100 * 80 * 4);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 100; x++) source.pixels.set([x, y, (x * 7 + y * 13) % 256, 255], (y * 100 + x) * 4);
  await h.api.renderCurrent(); await infrastructure().flush();
  assert.equal(h.inspect.previewPixelReason(true), '');
  h.get('viewport').getBoundingClientRect = () => ({ ...rect(0, 0, 1000, 700), right: 1000, bottom: 700 });
  h.get('imageSurface').getBoundingClientRect = () => {
    const s = h.api.get(), width = parseFloat(h.get('imageSurface').style.width), height = parseFloat(h.get('imageSurface').style.height);
    const left = 500 + s.panX - width / 2, top = 350 + s.panY - height / 2;
    return { left, top, width, height, right: left + width, bottom: top + height };
  };
  h.readbacks = []; h.watch = c => {
    const base = c.getContext.bind(c); c.getContext = (...args) => { const ctx = base(...args), get = ctx.getImageData;
      return { ...ctx, getImageData: (...args) => { h.readbacks.push({ canvas: c, args }); return get(...args); } }; };
  };
  h.watch(h.inspect.get().acceptedRender.canvas);
  h.enable = value => { h.get('previewPixelToggle').checked = value; h.fire('previewPixelToggle', 'change'); };
  h.move = (x, y, extra = {}) => h.fire('viewport', 'pointermove', { pointerId: 9, clientX: x, clientY: y, ...extra });
  h.pixel = (x, y) => { const r = h.get('imageSurface').getBoundingClientRect(), im = h.inspect.get().acceptedRender; h.move(r.left + (x + .5) * r.width / im.width, r.top + (y + .5) * r.height / im.height); };
  h.text = () => h.get('previewPixelReadout').textContent;
  return h;
}
function assertReadout(h, value) {
  const text = h.text(); assert.match(text, new RegExp(`x ${value.x} · y ${value.y} ·`)); assert.match(text, new RegExp(`A ${value.a}(?: ·|$)`));
  if (value.a) assert.match(text, new RegExp(`R ${value.r} · G ${value.g} · B ${value.b}`)); else { assert.match(text, /RGB —（完全透明/); assert.doesNotMatch(text, /码值端点/); }
}

test('independent pixel UI: opt-in defaults and labeling advertise only zero-based 8-bit sRGB processed-preview codes', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8'), h = await ui();
  assert.ok(html.indexOf('src="preview-pixel-inspector.cjs"') < html.indexOf('src="app.js"'));
  assert.doesNotMatch(html.match(/<input id="previewPixelToggle"[^>]*>/)[0], /\bchecked\b/);
  assert.match(html, /8-bit sRGB PREVIEW/); assert.match(html, /x\/y 从 0 开始/); assert.match(html, /不是原图采样或 RAW 过曝判断/);
  assert.equal(h.inspect.get().previewPixelEnabled, false); assert.equal(h.get('previewPixelDetails').hidden, true); assert.equal(h.inspect.get().previewPixelCache, null);
  h.pixel(0, 0); assert.equal(h.readbacks.length, 0); assert.equal(h.text(), '');
});

test('independent pixel UI: accepted canvas wins over a conflicting previewCanvas, alpha zero hides RGB and partial alpha stays uncomposited', async () => {
  const h = await ui(), accepted = h.inspect.get().acceptedRender.canvas;
  accepted.pixels.set([0, 255, 37, 128, 255, 0, 255, 0, 255, 0, 255, 255], 0);
  h.get('previewCanvas').pixels = new Uint8ClampedArray(100 * 80 * 4).fill(199);
  h.get('previewCanvas').getContext = () => { throw Error('display/overlay canvas must not be sampled'); };
  h.enable(true); assert.equal(h.readbacks.length, 1); assert.equal(h.readbacks[0].canvas, accepted);
  assert.deepEqual(h.readbacks[0].args.slice(0, 4), [0, 0, 100, 80]); assert.deepEqual(plain(h.readbacks[0].args[4]), { colorSpace: 'srgb', pixelFormat: 'rgba-unorm8' });
  for (let x = 0; x < 3; x++) { h.pixel(x, 0); assertReadout(h, sampleOracle(image(100, 80, accepted.pixels), x, 0)); }
  h.pixel(0, 0); assert.match(h.text(), /半透明：RGB 未与棋盘格合成/); assert.match(h.text(), /R = 0；G = 255/);
  h.pixel(1, 0); assert.doesNotMatch(h.text(), /半透明|码值端点|255/);
  h.pixel(2, 0); assert.match(h.text(), /G = 0；R\/B = 255/); assert.equal(h.readbacks.length, 1);
});

test('independent pixel UI: actual pan/wheel/fit handlers remap a single cached frame without readback or render per movement', async () => {
  const h = await ui(); h.enable(true); const cached = h.inspect.get().previewPixelCache, renders = h.calls.renders.length, before = hash(cached.image.data);
  for (let i = 0; i < 300; i++) h.pixel(i % 100, i % 80);
  assertReadout(h, sampleOracle(cached.image, 99, 59));
  for (let i = 0; i < 20; i++) { h.fire('viewport', 'wheel', { deltaY: i % 2 ? 53 : -71, clientX: 503, clientY: 351 }); h.pixel(37, 21); assertReadout(h, sampleOracle(cached.image, 37, 21)); }
  h.fire('viewport', 'pointerdown', { button: 0, pointerId: 9, clientX: 500, clientY: 350 });
  h.move(621, 423); h.fire('viewport', 'pointerup', { pointerId: 9 }); h.pixel(63, 42); assertReadout(h, sampleOracle(cached.image, 63, 42));
  h.fire('fitBtn'); h.pixel(5, 7); assertReadout(h, sampleOracle(cached.image, 5, 7));
  assert.equal(h.readbacks.length, 1); assert.equal(h.calls.renders.length, renders); assert.equal(h.inspect.get().previewPixelCache, cached); assert.equal(hash(cached.image.data), before);
});

test('independent pixel UI: CSS-visible viewport clips the image and right/bottom edges clear values instead of clamping', async () => {
  const h = await ui(); h.enable(true); h.get('viewport').getBoundingClientRect = () => rect(30, 20, 500, 350);
  h.get('imageSurface').getBoundingClientRect = () => rect(-100, -50, 1000, 800);
  for (const p of [{ x: 30, y: 20 }, { x: 529.999, y: 369.999 }, { x: 29.99, y: 50 }, { x: 530, y: 50 }, { x: 50, y: 370 }, { x: -100, y: -50 }]) {
    h.move(p.x, p.y); const expected = mapOracle(p, rect(-100, -50, 1000, 800), rect(30, 20, 500, 350), { width: 100, height: 80 });
    if (expected) assertReadout(h, sampleOracle(h.inspect.get().previewPixelCache.image, expected.x, expected.y)); else assert.doesNotMatch(h.text(), / · x \d+ · y \d+/);
  }
  h.fire('viewport', 'pointerleave'); assert.equal(h.inspect.get().previewPixelPointer, null); assert.doesNotMatch(h.text(), / · x \d+/); assert.equal(h.readbacks.length, 1);
});

test('independent pixel UI: crop, clockwise rotation and flip map final pixels, not source coordinates, at multiple zooms', async () => {
  const h = await ui(), p = h.api.photos[0];
  h.api.changeSettings({ framing: { version: 1, crop: { x: .1, y: .25, w: .6, h: .5 }, quarterTurns: 1, flipX: true, flipY: false } });
  await h.api.renderCurrent(); const c = h.inspect.get().acceptedRender.canvas; assert.equal(c.width, 40); assert.equal(c.height, 60); h.watch(c); h.enable(true);
  for (const zoom of [.15, 1, 3.7]) {
    h.inspect.set({ zoom }); h.api.positionSurface();
    for (const [x, y] of [[0, 0], [39, 0], [0, 59], [39, 59], [17, 29]]) {
      // For clockwise rotation followed by horizontal flip, (x,y) maps to
      // cropped source (y,x), plus the authored crop offset (10,20).
      const sx = y + 10, sy = x + 20; h.pixel(x, y);
      assertReadout(h, { x, y, r: sx, g: sy, b: (sx * 7 + sy * 13) % 256, a: 255 });
    }
  }
  assert.equal(h.readbacks.length, 1); assert.equal(p.settings.framing.quarterTurns, 1);
});

for (const state of ['compare', 'held-original', 'reference', 'crop', 'manual', 'point-tool', 'matte-tool', 'local-inspection', 'matte-inspection', 'diagnostic', 'face-boxes', 'manual-draft', 'matte-draft', 'nonpan-pointer', 'export-lock', 'project-lock', 'preset-lock', 'opening-dialog', 'analyzing', 'backend', 'pending', 'failed']) {
  test(`independent pixel UI: ${state} clears values/cache without changing enabled preference or admitting old pixels`, async () => {
    const h = await ui(), p = h.api.photos[0]; h.enable(true); h.pixel(10, 20); assertReadout(h, sampleOracle(h.inspect.get().previewPixelCache.image, 10, 20));
    if (state === 'compare') h.api.setCompare(true);
    if (state === 'held-original') { h.api.set({ originalHeld: true }); h.api.drawPreview(); }
    if (state === 'reference') { h.inspect.pinReference(); h.inspect.setReferenceCompare(true); }
    if (state === 'crop') h.api.startCropDraft();
    if (state === 'manual') h.api.setTool('repair-heal');
    if (state === 'point-tool') h.api.setTool('brush');
    if (state === 'matte-tool') h.inspect.set({ tool: 'matte-keep' });
    if (state === 'local-inspection') p.localInspect = true;
    if (state === 'matte-inspection') p.matteInspect = true;
    if (state === 'diagnostic') p.settings.diagnosticOverlay = true;
    if (state === 'face-boxes') h.get('learnedFaceBoxes').checked = true;
    if (state === 'manual-draft') h.api.set({ manualDraft: { photoId: p.id } });
    if (state === 'matte-draft') h.api.set({ matteDraft: { photoId: p.id } });
    if (state === 'nonpan-pointer') h.api.set({ pointer: { id: 7, kind: 'compare' } });
    if (state === 'export-lock') h.api.set({ exportRunning: true });
    if (state === 'project-lock') h.inspect.set({ projectOperation: 'save' });
    if (state === 'preset-lock') h.api.set({ presetOperation: { kind: 'apply' } });
    if (state === 'opening-dialog') h.inspect.set({ openingDialog: true });
    if (state === 'analyzing') h.api.set({ analyzingPhoto: true });
    if (state === 'backend') h.api.set({ backendJob: { photoId: p.id } });
    if (state === 'pending') h.inspect.set({ renderPending: true });
    if (state === 'failed') h.inspect.set({ renderFailure: 'authored failed frame' });
    h.move(500, 350); assert.equal(h.inspect.get().previewPixelEnabled, true); assert.equal(h.inspect.get().previewPixelCache, null); assert.notEqual(h.inspect.previewPixelReason(), ''); assert.doesNotMatch(h.text(), / · x \d+ · y \d+/);
    assert.equal(h.readbacks.length, 1);
    h.enable(false); assert.equal(h.inspect.get().previewPixelEnabled, false); assert.equal(h.inspect.get().previewPixelCache, null); assert.equal(h.text(), '');
  });
}

for (const change of ['same-stamp-recipe', 'nested-recipe', 'photo', 'blob', 'source', 'revision', 'generation', 'view-token', 'canvas-identity', 'canvas-size']) {
  test(`independent pixel UI: cache rejects ${change} provenance mismatch`, async () => {
    const h = await ui(), p = h.api.photos[0]; h.enable(true); h.pixel(3, 4); const old = h.inspect.get().acceptedRender;
    if (change === 'same-stamp-recipe') p.settings.exposure++;
    if (change === 'nested-recipe') p.settings.spots.push({ x: .5, y: .5, r: .01 });
    if (change === 'photo') h.api.set({ currentId: h.photo('different').id });
    if (change === 'blob') p.blob = new Blob([await p.blob.arrayBuffer()], { type: p.blob.type });
    if (change === 'source') h.api.set({ source: h.canvas(100, 80) });
    if (change === 'revision') p.sourceRevision += ':new';
    if (change === 'generation') h.inspect.set({ renderVersion: old.generation + 1 });
    if (change === 'view-token') h.api.set({ viewToken: old.viewToken + 1 });
    if (change === 'canvas-identity') h.inspect.set({ rendered: h.canvas(100, 80) });
    if (change === 'canvas-size') old.canvas.width++;
    h.inspect.syncPreviewPixelInspector(); h.move(500, 350);
    assert.equal(h.inspect.get().previewPixelCache, null); assert.doesNotMatch(h.text(), / · x \d+ · y \d+/); assert.equal(h.readbacks.length, 1);
  });
}

test('independent pixel UI: real edit debounce, rejected render and retry remove then rebuild cache for only the latest accepted frame', async () => {
  const h = await ui(); h.enable(true); h.pixel(50, 40); const originalRender = h.pipeline.render, old = h.inspect.get().previewPixelCache;
  h.api.changeSettings({ exposure: 20 }); assert.equal(h.inspect.get().previewPixelCache, null); assert.doesNotMatch(h.text(), / · x \d+/);
  const pending = infrastructure().defer(); h.pipeline.render = () => pending.promise; const task = h.api.renderCurrent(); h.move(500, 350); assert.equal(h.inspect.get().previewPixelCache, null);
  pending.reject(Error('authored failed replacement')); await task; assert.match(h.text(), /失败/); assert.equal(h.inspect.get().previewPixelCache, null);
  h.pipeline.render = originalRender; await h.api.renderCurrent(); await infrastructure().flush(); const fresh = h.inspect.get().previewPixelCache;
  assert.ok(fresh); assert.notEqual(fresh, old); assert.notEqual(fresh.accepted, old.accepted); assert.notEqual(fresh.image.data.buffer, old.image.data.buffer);
  h.pixel(50, 40); assertReadout(h, sampleOracle(fresh.image, 50, 40));
});

test('independent pixel UI: stale in-flight render completion cannot regain a readout after a newer accepted render', async () => {
  const h = await ui(); h.enable(true); const render = h.pipeline.render, first = infrastructure().defer(); h.pipeline.render = () => first.promise;
  const pending = h.api.renderCurrent(); h.api.changeSettings({ exposure: 23 }); h.pipeline.render = render; await h.api.renderCurrent(); const current = h.inspect.get().previewPixelCache;
  const decoy = h.canvas(100, 80); decoy.pixels = new Uint8ClampedArray(100 * 80 * 4).fill(229); first.resolve(decoy); await pending;
  assert.equal(h.inspect.get().previewPixelCache, current); assert.equal(h.inspect.get().acceptedRender, current.accepted); h.pixel(50, 40); assertReadout(h, sampleOracle(current.image, 50, 40));
});

test('independent pixel UI: readback errors do not loop, off/on recovers once, and disable always releases the bounded array', async () => {
  const h = await ui(), canvas = h.inspect.get().acceptedRender.canvas, original = canvas.getContext.bind(canvas); let attempts = 0;
  canvas.getContext = () => ({ getImageData() { attempts++; throw Error('authored readback failure'); } });
  h.enable(true); assert.equal(attempts, 1); assert.equal(h.inspect.get().previewPixelCache, null); assert.match(h.text(), /无法读取/);
  for (let i = 0; i < 30; i++) { h.move(500 + i, 350); h.inspect.syncPreviewPixelInspector(); } assert.equal(attempts, 1);
  canvas.getContext = original; h.enable(false); h.enable(true); assert.ok(h.inspect.get().previewPixelCache); assert.equal(h.readbacks.length, 1); h.pixel(10, 20); assertReadout(h, sampleOracle(h.inspect.get().previewPixelCache.image, 10, 20));
  h.enable(false); assert.equal(h.inspect.get().previewPixelCache, null); assert.equal(h.inspect.get().previewPixelPointer, null); assert.equal(h.text(), ''); assert.equal(h.get('previewPixelDetails').hidden, true);
});

test('independent pixel UI: reentrant invalidation during readback cannot publish old cache', async () => {
  const h = await ui(), c = h.inspect.get().acceptedRender.canvas, base = c.getContext.bind(c); let calls = 0;
  c.getContext = () => { const ctx = base(); return { ...ctx, getImageData(...args) { calls++; const result = ctx.getImageData(...args); h.inspect.scheduleRender(); return result; } }; };
  h.enable(true); assert.equal(calls, 1); assert.equal(h.inspect.get().previewPixelCache, null); assert.doesNotMatch(h.text(), / · x \d+/);
});

test('independent pixel UI: readout preserves complete project bytes, histories, preset, review, native dirty and export scope', async () => {
  const P = require('../src/project-document.cjs'), h = await ui(), p = h.api.photos[0];
  h.api.changeSettings({ exposure: 12 }); h.api.undo(); h.api.redo(); await h.api.renderCurrent(); h.api.applyPhotoReview(infrastructure().realm(h, { rating: 4, flag: 'pick' }), '', 'current');
  await h.api.saveProject(); await infrastructure().flush(); await h.api.renderCurrent();
  h.get('exportScope').value = 'selected'; const before = await h.api.projectSnapshot(), encoded = await P.encode(structuredClone(before)), fingerprint = h.api.projectFingerprint(), dirty = h.calls.dirty.slice(), raw = new Uint8Array(await p.blob.arrayBuffer());
  const preset = plain(h.api.presetDocumentFromPhoto(p, 'readout-safety')), renders = h.calls.renders.length, models = h.calls.model, decodes = h.calls.decoded.length;
  h.enable(true); for (let i = 0; i < 100; i++) h.pixel(i % 100, i % 80); h.fire('viewport', 'wheel', { deltaY: -100, clientX: 500, clientY: 350 }); h.fire('fitBtn'); h.enable(false);
  assert.equal(h.api.projectFingerprint(), fingerprint); assert.deepEqual(plain(await h.api.projectSnapshot()), plain(before)); assert.deepEqual(await P.encode(structuredClone(await h.api.projectSnapshot())), encoded);
  assert.deepEqual(new Uint8Array(await p.blob.arrayBuffer()), raw); assert.deepEqual(plain(h.api.presetDocumentFromPhoto(p, 'readout-safety')), preset); assert.deepEqual(h.calls.dirty, dirty); assert.equal(h.api.hasUnsavedProjectChanges(), false); assert.equal(h.get('exportScope').value, 'selected');
  assert.equal(h.calls.renders.length, renders); assert.equal(h.calls.model, models); assert.equal(h.calls.decoded.length, decodes);
});

test('independent pixel core: bounded subviews cannot retain oversized backing storage and resizable storage is refused', () => {
  const oversized = new Uint8Array(I.LIMITS.maxBytes + 4); assert.throws(() => I.samplePixel({ width: 1, height: 1, data: oversized.subarray(0, 4) }, 0, 0));
  const bounded = new Uint8Array(I.LIMITS.maxBytes); bounded.set([15, 51, 111, 255], I.LIMITS.maxBytes - 4);
  assert.equal(I.samplePixel({ width: 1, height: 1, data: bounded.subarray(-4) }, 0, 0).r, 15);
  if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')) assert.throws(() => I.samplePixel({ width: 1, height: 1, data: new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })) }, 0, 0));
});

test('independent pixel mapping: malformed/extreme rectangles and symbol/nonenumerable fields fail before getter execution', () => {
  const p = { x: 0, y: 0 }, r = rect(0, 0, 100, 80), s = { width: 100, height: 80 };
  for (const bad of [rect(0, 0, 0, 80), rect(0, 0, 100, -1), rect(Infinity, 0, 100, 80), rect(0, NaN, 100, 80), rect(0, 0, '100', 80), rect(1e100, 0, 100, 80), rect(0, 0, 1e100, 80)]) assert.throws(() => I.mapPoint(p, bad, r, s));
  for (const patch of [value => Object.defineProperty(value, 'x', { enumerable: false }), value => Object.defineProperty(value, Symbol('hidden'), { value: 1 })]) { const q = { ...p }; patch(q); assert.throws(() => I.mapPoint(q, r, r, s)); }
  const tiny = rect(0, 0, Number.MIN_VALUE, Number.MIN_VALUE); assert.deepEqual(I.mapPoint(p, tiny, r, s), { x: 0, y: 0 });
});

test('independent pixel UI: overbudget accepted canvas is refused before getContext/readback or allocation', async () => {
  const h = await ui(), a = h.inspect.get().acceptedRender; a.width = a.canvas.width = 1281; a.height = a.canvas.height = 80;
  let contexts = 0; a.canvas.getContext = () => { contexts++; throw Error('must reject before requesting context'); };
  h.enable(true); assert.equal(contexts, 0); assert.equal(h.inspect.get().previewPixelCache, null); assert.match(h.text(), /无法读取/);
});

test('independent pixel UI: actual source switch clears old identity during decode and remaps the new aspect ratio/zoom after fresh render', async () => {
  const h = await ui(), other = h.photo('new-photo'); h.enable(true); h.inspect.set({ zoom: 3.2, panX: 11, panY: 8 }); h.api.positionSurface(); h.pixel(25, 30); const old = h.inspect.get().previewPixelCache;
  const pending = infrastructure().defer(); h.pipeline.decodeImage = () => pending.promise; const switching = h.api.activatePhoto(other.id);
  assert.equal(h.inspect.get().previewPixelCache, null); h.move(500, 350); assert.doesNotMatch(h.text(), /old\.png| · x \d+/);
  const source = h.canvas(80, 120); source.pixels = new Uint8ClampedArray(80 * 120 * 4); for (let i = 0; i < 80 * 120; i++) source.pixels.set([213, 17, 61, 255], i * 4);
  pending.resolve({ canvas: source, originalWidth: 1600, originalHeight: 2400 }); await switching;
  const id = h.inspect.get().renderTimer, queued = h.calls.timers.get(id); assert.ok(queued); h.calls.timers.delete(id); queued.fn(); await infrastructure().flush();
  const fresh = h.inspect.get().previewPixelCache; assert.ok(fresh); assert.notEqual(fresh.accepted, old.accepted); assert.equal(fresh.accepted.photo, other); assert.equal(fresh.image.width, 80); assert.equal(fresh.image.height, 120);
  h.pixel(79, 119); assertReadout(h, { x: 79, y: 119, r: 213, g: 17, b: 61, a: 255 }); assert.match(h.text(), /new-photo\.png/); assert.doesNotMatch(h.text(), /old\.png/); assert.equal(h.api.get().zoom, 1);
});

test('independent pixel UI: undo and redo clear enabled readouts immediately and refill only after their replacement frame', async () => {
  const h = await ui(), p = h.api.photos[0]; h.api.changeSettings({ exposure: 24 }); await h.api.renderCurrent(); h.enable(true); h.pixel(20, 30); const changed = h.inspect.get().previewPixelCache;
  h.api.undo(); assert.equal(p.settings.exposure, 0); assert.equal(h.inspect.get().previewPixelCache, null); assert.doesNotMatch(h.text(), / · x \d+/); await h.api.renderCurrent(); h.pixel(20, 30); assertReadout(h, { x: 20, y: 30, r: 20, g: 30, b: 18, a: 255 });
  h.api.redo(); assert.equal(p.settings.exposure, 24); assert.equal(h.inspect.get().previewPixelCache, null); await h.api.renderCurrent(); h.pixel(20, 30); assertReadout(h, sampleOracle(changed.image, 20, 30)); assert.equal(p.undo.length, 1); assert.equal(p.redo.length, 0);
});

test('independent pixel UI: actual preset application rebuilds the accepted readout without adding inspector history', async () => {
  const h = await ui(), p = h.api.photos[0]; h.enable(true); const doc = h.api.presetDocumentFromPhoto(p, 'authored preview replacement'); doc.controls.basic.exposure = 36;
  h.api.stageNamedPreset(doc, 'synthetic independent QA'); h.get('namedPresetScope').value = 'current'; h.get('namedPresetMode').value = 'color'; const task = h.api.applyNamedPreset();
  assert.equal(h.inspect.get().previewPixelCache, null); const frame = [...h.calls.timers].find(([, entry]) => entry.delay === 0); assert.ok(frame); h.calls.timers.delete(frame[0]); frame[1].fn(); await task; await infrastructure().flush();
  assert.equal(p.settings.exposure, 36); assert.equal(p.undo.length, 1); const queuedId = h.inspect.get().renderTimer, queued = h.calls.timers.get(queuedId); if (queued) { h.calls.timers.delete(queuedId); queued.fn(); await infrastructure().flush(); }
  assert.ok(h.inspect.get().previewPixelCache); h.pixel(35, 21); assertReadout(h, sampleOracle(h.inspect.get().previewPixelCache.image, 35, 21));
});

for (const outcome of ['cancel', 'failure']) test(`independent pixel UI: interrupted project ${outcome} resumes its own queued fresh readout without manual render`, async () => {
  const h = await ui(); h.enable(true); h.api.changeSettings({ exposure: 31 }); const scheduled = h.calls.timers.get(h.inspect.get().renderTimer), pending = infrastructure().defer(); h.bridge.openProject = () => pending.promise;
  const task = h.api.openProject(); scheduled.fn(); await infrastructure().flush(); assert.equal(h.inspect.get().previewPixelCache, null); assert.equal(h.inspect.get().renderTimer, null);
  if (outcome === 'cancel') pending.resolve({ canceled: true }); else pending.reject(Error('authored canceled/failed project'));
  await task; await infrastructure().flush(); const id = h.inspect.get().renderTimer, resumed = h.calls.timers.get(id); assert.ok(resumed); h.calls.timers.delete(id); resumed.fn(); await infrastructure().flush();
  const cache = h.inspect.get().previewPixelCache; assert.ok(cache); h.pixel(10, 10); assertReadout(h, sampleOracle(cache.image, 10, 10)); assert.equal(h.api.photos[0].settings.exposure, 31);
});

test('independent pixel UI: project replacement binds the readout to restored photo only and never persists view-only state', async () => {
  const P = require('../src/project-document.cjs'), bytes = await P.encode(infrastructure().snapshot('restored-inspector', { exposure: 16 }));
  const h = await ui({ bridge: { openProject: async () => ({ bytes, displayName: 'synthetic.mintproj' }) } }); h.enable(true); const old = h.inspect.get().previewPixelCache; await h.api.openProject(); await infrastructure().flush();
  const id = h.inspect.get().renderTimer, queued = h.calls.timers.get(id); if (queued) { h.calls.timers.delete(id); queued.fn(); await infrastructure().flush(); }
  const fresh = h.inspect.get().previewPixelCache; assert.ok(fresh); assert.notEqual(fresh.accepted, old.accepted); assert.equal(fresh.accepted.photo.id, 'restored-inspector'); h.pixel(30, 40); assertReadout(h, sampleOracle(fresh.image, 30, 40)); assert.match(h.text(), /restored-inspector\.png/);
  assert.equal(h.api.hasUnsavedProjectChanges(), false); const snapshot = await h.api.projectSnapshot(); assert.doesNotMatch(JSON.stringify(snapshot), /previewPixel|pixelInspector/); h.inspect.clearSessionView(); assert.equal(h.inspect.get().previewPixelCache, null); assert.doesNotMatch(h.text(), / · x \d+/);
});

test('independent pixel UI: leave, window blur and pagehide clear pointer/readout without allocating additional cache', async () => {
  const h = await ui(); h.enable(true); h.pixel(10, 20); h.events.get('blur')(); assert.equal(h.inspect.get().previewPixelPointer, null); assert.doesNotMatch(h.text(), / · x \d+/); assert.equal(h.readbacks.length, 1);
  h.pixel(50, 60); h.events.get('pagehide')(); assert.equal(h.inspect.get().previewPixelEnabled, false); assert.equal(h.inspect.get().previewPixelCache, null); assert.equal(h.text(), '');
});

let NativeCanvas; try { NativeCanvas = require('@napi-rs/canvas'); } catch {}
test('independent pixel native raster: 65,536 RGBA samples cover all alpha values and match real readback, not a checkerboard composite', { skip: !NativeCanvas && 'Installed native raster unavailable; no browser claim' }, async () => {
  const width = 256, height = 256, canvas = NativeCanvas.createCanvas(width, height), ctx = canvas.getContext('2d'), authored = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) authored.data.set([x, 255 - x, (x * 17 + y * 3) % 256, y], (y * width + x) * 4);
  ctx.putImageData(authored, 0, 0); const pixels = ctx.getImageData(0, 0, width, height), im = { width, height, data: pixels.data }, digest = hash(im.data);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) assert.deepEqual(I.samplePixel(im, x, y), sampleOracle(im, x, y));
  assert.equal(hash(im.data), digest); assert.equal(I.samplePixel(im, 0, 0).r, null); assert.equal(I.samplePixel(im, 0, 1).alphaMode, 'partial');
  const sharp = require('sharp'), png = await sharp(Buffer.from(im.data), { raw: { width, height, channels: 4 } }).png().toBuffer();
  const decoded = await sharp(png).ensureAlpha().raw().toBuffer(); assert.equal(hash(decoded), digest, 'evidence PNG must exactly preserve native accepted readback');
  if (process.env.MINT_PIXEL_QA_EVIDENCE === '1') {
    const out = path.join(__dirname, '../quality/preview-pixel-inspector-qa'); fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'synthetic-native-alpha-rgba.png'), png);
    const points = [[0, 0], [255, 0], [0, 1], [255, 1], [17, 64], [255, 128], [0, 255], [255, 255]];
    fs.writeFileSync(path.join(out, 'synthetic-native-alpha-evidence.json'), JSON.stringify({ evidenceType: 'Synthetic native Skia pixel readback and pure-helper QA. NOT an app screenshot or browser/Electron acceptance.', width, height, testedPixels: width * height, distinctAlphaValues: 256, nativeCanvasVersion: require('@napi-rs/canvas/package.json').version, sharpVersion: sharp.versions.sharp, acceptedReadbackRgbaSha256: digest, pngSha256: hash(png), decodedPngRgbaSha256: hash(decoded), pngMatchesReadbackExactly: true, note: 'Native premultiplied storage may quantize authored partial-alpha RGB. The authoritative values tested are the actual uncomposited getImageData bytes, not pre-storage authored values or checkerboard colors.', points: points.map(([x, y]) => ({ authored: Array.from(authored.data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)), readout: I.samplePixel(im, x, y) })) }, null, 2) + '\n');
  }
});

test('independent pixel native UI: actual app handler samples native canvas with explicit Skia API adaptation only', { skip: !NativeCanvas && 'Installed native raster unavailable; no browser claim' }, async () => {
  const h = await ui(), c = NativeCanvas.createCanvas(100, 80), base = c.getContext.bind(c), ctx = base('2d'), pixels = ctx.createImageData(100, 80);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 100; x++) pixels.data.set([x === 0 ? 0 : 255, y * 3, 103, x % 4 === 0 ? 0 : x % 4 === 1 ? 17 : 255], (y * 100 + x) * 4);
  ctx.putImageData(pixels, 0, 0); const accepted = ctx.getImageData(0, 0, 100, 80), expected = { width: 100, height: 80, data: accepted.data }; let readbacks = 0;
  // Installed @napi-rs/canvas accepts a string color-space parameter; Chromium
  // accepts ImageDataSettings. This adapter preserves the real native pixels and
  // verifies the actual production settings rather than claiming browser QA.
  c.getContext = (...args) => { const context = base(...args); return { getImageData(x, y, w, height, options) { assert.deepEqual(plain(options), { colorSpace: 'srgb', pixelFormat: 'rgba-unorm8' }); readbacks++; return context.getImageData(x, y, w, height, 'srgb'); } }; };
  h.inspect.get().acceptedRender.canvas = c; h.inspect.set({ rendered: c }); h.enable(true);
  for (const [x, y] of [[0, 0], [1, 20], [2, 30], [99, 79]]) { h.pixel(x, y); assertReadout(h, sampleOracle(expected, x, y)); }
  assert.equal(readbacks, 1); h.fire('viewport', 'wheel', { deltaY: -111, clientX: 500, clientY: 350 }); h.pixel(1, 20); assertReadout(h, sampleOracle(expected, 1, 20)); assert.equal(readbacks, 1);
});

test('independent pixel native raster: full 1280-square allocation is accepted at exactly 6.25 MiB and copied only for readback', { skip: !NativeCanvas && 'Installed native raster unavailable; no browser claim' }, () => {
  const c = NativeCanvas.createCanvas(1280, 1280), ctx = c.getContext('2d'); ctx.fillStyle = 'rgb(0,255,19)'; ctx.fillRect(0, 0, 1280, 1280);
  const data = ctx.getImageData(0, 0, 1280, 1280).data, im = { width: 1280, height: 1280, data }; assert.equal(data.byteLength, I.LIMITS.maxBytes); assert.equal(data.buffer.byteLength, I.LIMITS.maxBytes);
  for (const [x, y] of [[0, 0], [1279, 0], [0, 1279], [1279, 1279], [641, 711]]) assert.deepEqual(I.samplePixel(im, x, y), { x, y, r: 0, g: 255, b: 19, a: 255, alphaMode: 'opaque', zeroChannels: ['R'], fullChannels: ['G'] });
});

for (const event of ['pointercancel', 'lostpointercapture']) test(`independent pixel UI: ${event} removes captured coordinate without dropping the valid cached frame`, async () => {
  const h = await ui(); h.enable(true); h.pixel(10, 20); const cache = h.inspect.get().previewPixelCache;
  h.fire('viewport', 'pointerdown', { button: 0, pointerId: 9, clientX: 500, clientY: 350 }); h.move(517, 363); h.fire('viewport', event, { pointerId: 9 });
  assert.equal(h.inspect.get().previewPixelPointer, null); assert.doesNotMatch(h.text(), / · x \d+/); assert.equal(h.inspect.get().previewPixelCache, cache); assert.equal(h.readbacks.length, 1);
});

test('independent pixel UI: wheel uses its own coordinates rather than the most recent hover position', async () => {
  const h = await ui(); h.enable(true); h.pixel(1, 1); const im = h.inspect.get().previewPixelCache.image, before = h.get('imageSurface').getBoundingClientRect();
  const p = { x: before.left + 70.5 * before.width / im.width, y: before.top + 53.5 * before.height / im.height };
  h.fire('viewport', 'wheel', { clientX: p.x, clientY: p.y, deltaY: -100 }); assertReadout(h, sampleOracle(im, 70, 53)); assert.equal(h.readbacks.length, 1);
});
