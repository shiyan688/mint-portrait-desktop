'use strict';
// Rehashed historical frames must not inherit newly introduced v16 fields.
function historicalImageFields(doc) {
  if (doc.format === 'mint-portrait-project' && doc.version < 16) for (const photo of doc.photos) {
    delete photo.imageAssets;
    for (const state of [photo.settings, photo.committed, ...photo.undo, ...photo.redo, photo.exportedSettings].filter(Boolean)) delete state.imageLayers;
  }
  return doc;
}

// Independent adversarial review. Geometry expectations use an array-of-rows
// oracle, not MintGeometry.plan/apply. VM tests are source execution, not browser QA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const sharp = require('sharp');
const G = require('../src/geometry.cjs');
const P = require('../src/project-document.cjs');
const Core = require('../export-render-core.cjs');
const Manual = require('../src/manual-tools.cjs');
const { createExportRenderer } = require('../export-renderer.cjs');
const ROOT = path.join(__dirname, '..');
const REV = 'independent-geometry:0';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const frame = extra => ({ version: 1, crop: { x: 0, y: 0, w: 1, h: 1 }, quarterTurns: 0, flipX: false, flipY: false, ...extra });
const settings = extra => ({ ...P.DEFAULT_SETTINGS, spots: [], localLayers: [], manualLiquify: [], manualRepair: [], ...extra });
function picture(width, height, alpha = true) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const n = y * width + x;
    data.set([n % 256, Math.floor(n / 256) % 256, (x * 31 + y * 19 + 17) % 256, alpha ? [0, 1, 17, 127, 254, 255][n % 6] : 255], n * 4);
  }
  return { width, height, data };
}
function oracle(im, recipe) {
  const r = recipe || frame(), c = r.crop;
  const left = Math.min(im.width - 1, Math.round(im.width * c.x));
  const top = Math.min(im.height - 1, Math.round(im.height * c.y));
  const right = Math.max(left + 1, Math.min(im.width, Math.round(im.width * (c.x + c.w))));
  const bottom = Math.max(top + 1, Math.min(im.height, Math.round(im.height * (c.y + c.h))));
  let rows = [];
  for (let y = top; y < bottom; y++) {
    const row = [];
    for (let x = left; x < right; x++) row.push(Array.from(im.data.subarray((y * im.width + x) * 4, (y * im.width + x + 1) * 4)));
    rows.push(row);
  }
  for (let turn = 0; turn < r.quarterTurns; turn++) {
    const previous = rows;
    rows = Array.from({ length: previous[0].length }, (_, y) => previous.map(row => row[y]).reverse());
  }
  if (r.flipX) rows = rows.map(row => row.slice().reverse());
  if (r.flipY) rows = rows.slice().reverse();
  return { width: rows[0].length, height: rows.length, data: new Uint8ClampedArray(rows.flat(2)) };
}
const png = im => sharp(Buffer.from(im.data), { raw: { width: im.width, height: im.height, channels: 4 } }).png().toBuffer();
const request = (bytes, extra = {}) => ({ requestId: 'independent-frame', bytes, sourceRevision: REV, settings: settings(), analysis: { landmarks: [], sourceRevision: REV }, mode: 'original', format: 'png', quality: .95, ...extra });
async function nativeExport(r) { const s = createExportRenderer(); try { return await s.render(r); } finally { s.dispose(); } }
function pixelWorker(im, s) {
  let result;
  const ctx = vm.createContext({ rgba: Array.from(im.data), width: im.width, height: im.height, serialized: JSON.stringify(s), rev: REV, self: { postMessage: data => { result = data; } } });
  ctx.importScripts = (...names) => { for (const name of names) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', name), 'utf8'), ctx); };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/pixel-worker.js'), 'utf8'), ctx);
  vm.runInContext('self.onmessage({data:{width,height,buffer:Uint8ClampedArray.from(rgba).buffer,settings:JSON.parse(serialized),analysis:{landmarks:[],sourceRevision:rev}}})', ctx);
  if (result.error) throw new Error(result.error);
  return { width: result.width, height: result.height, data: new Uint8ClampedArray(result.buffer) };
}
function isolatedGeometry(code) {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/geometry.cjs'), 'utf8'), ctx);
  return vm.runInContext(code, ctx);
}
function pipelineHarness({ withGeometry = true } = {}) {
  const workers = [];
  class Canvas {
    constructor(w = 7, h = 3) { this.width = w; this.height = h; this.reads = 0; this.pixels = picture(w, h).data; }
    getContext() { return { getImageData: () => { this.reads++; return { width: this.width, height: this.height, data: this.pixels.slice() }; }, putImageData: im => { this.pixels = im.data.slice(); } }; }
  }
  class Worker {
    constructor() { this.terminated = false; workers.push(this); }
    postMessage(input) { this.input = structuredClone(input); }
    terminate() { this.terminated = true; }
    finish(data) { this.onmessage({ data }); }
    correct() { const im = oracle({ width: this.input.width, height: this.input.height, data: new Uint8ClampedArray(this.input.buffer) }, this.input.settings.framing); this.finish({ width: im.width, height: im.height, buffer: im.data.buffer }); }
  }
  const context = vm.createContext({ URL, DOMException, Uint8Array, Uint8ClampedArray, Float32Array, structuredClone, queueMicrotask, AbortController, setTimeout, Worker, Blob, ImageData: class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } }, document: { createElement: () => new Canvas() } });
  if (withGeometry) context.MintGeometry = { plan: (w, h, r) => { const im = oracle(picture(w, h), r); return { outputSize: { width: im.width, height: im.height } }; } };
  let source = fs.readFileSync(path.join(ROOT, 'src/pipeline.js'), 'utf8');
  source = source.replace(/^import .*;$/m, '').replaceAll('import.meta.url', JSON.stringify('mint://app/src/pipeline.js')).replace(/^export /gm, '');
  vm.runInContext(source + '\nglobalThis.api={render,cancelRenders};', context);
  return { api: context.api, workers, Canvas };
}

for (const [width, height] of [[1, 1], [1, 9], [8, 1], [2, 3], [13, 7], [10, 11]]) {
  test(`independent oracle: ${width}x${height}, every turn/flip and boundary crop preserves exact RGBA`, () => {
    const im = picture(width, height), before = im.data.slice();
    const crops = [{ x: 0, y: 0, w: 1, h: 1 }, { x: .19, y: .27, w: .63, h: .51 }, { x: .999999, y: .999999, w: .000001, h: .000001 }, { x: .5 / width, y: .5 / height, w: .25 / width, h: .25 / height }];
    for (const crop of crops) for (let quarterTurns = 0; quarterTurns < 4; quarterTurns++) for (const flipX of [false, true]) for (const flipY of [false, true]) {
      const r = frame({ crop, quarterTurns, flipX, flipY }), expected = oracle(im, r), out = G.apply(im, r);
      assert.deepEqual(out, expected);
      assert.notEqual(out.data.buffer, im.data.buffer);
      assert.deepEqual(G.plan(width, height, r).outputSize, { width: expected.width, height: expected.height });
    }
    assert.deepEqual(im.data, before);
  });
}

test('half-pixel crop quantizes both boundaries, not separately rounded extents', () => {
  const im = picture(10, 3), r = frame({ crop: { x: .05, y: 0, w: .1, h: 1 } });
  assert.deepEqual(G.plan(10, 3, r).crop, { x: 1, y: 0, width: 1, height: 3 });
  assert.deepEqual(Array.from(G.apply(im, r).data).filter((_, i) => i % 4 === 0), [1, 11, 21]);
  for (const x of [.049999999999, .05, .050000000001]) assert.deepEqual(G.apply(im, frame({ crop: { x, y: 0, w: .1, h: 1 } })), oracle(im, frame({ crop: { x, y: 0, w: .1, h: 1 } })));
});

test('pixel-center maps match independent pixel labels and closed edge maps round-trip every corner', () => {
  for (const [w, h] of [[1, 1], [1, 7], [8, 1], [13, 7]]) for (let q = 0; q < 4; q++) for (const flipX of [false, true]) for (const flipY of [false, true]) {
    const r = frame({ quarterTurns: q, flipX, flipY }), out = oracle(picture(w, h), r);
    for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
      const n = out.data[(y * out.width + x) * 4], source = { x: n % w, y: Math.floor(n / w) };
      assert.deepEqual(G.mapPoint(w, h, r, { x, y }, 'inverse'), source);
      assert.deepEqual(G.mapPoint(w, h, r, source), { x, y });
    }
    for (const p of [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: 0, y: h }, { x: w, y: h }, { x: w / 3, y: h / 7 }]) {
      const d = G.mapEdgePoint(w, h, r, p), back = G.mapEdgePoint(w, h, r, d, 'inverse');
      assert.ok(Math.abs(back.x - p.x) < 1e-12 && Math.abs(back.y - p.y) < 1e-12);
      assert.ok(d.x >= 0 && d.x <= out.width && d.y >= 0 && d.y <= out.height);
    }
    assert.equal(G.mapPoint(w, h, r, { x: out.width, y: 0 }, 'inverse'), null);
    assert.equal(G.mapEdgePoint(w, h, r, { x: out.width + .01, y: 0 }, 'inverse'), null);
  }
});

test('discarded crop centers and edges never map to a retained pixel', () => {
  const r = frame({ crop: { x: .2, y: .25, w: .5, h: .5 }, quarterTurns: 1, flipY: true });
  for (const p of [{ x: 0, y: 3 }, { x: 7, y: 3 }, { x: 3, y: 1 }, { x: 3, y: 6 }]) assert.equal(G.mapPoint(10, 8, r, p), null);
  assert.notEqual(G.mapEdgePoint(10, 8, r, { x: 7, y: 6 }), null);
  assert.equal(G.mapEdgePoint(10, 8, r, { x: 7.01, y: 6 }), null);
});

test('malformed own accessors, hidden/symbol fields and custom prototypes fail without getter execution', () => {
  let reads = 0;
  const accessor = frame(); Object.defineProperty(accessor, 'flipX', { get() { reads++; return false; }, enumerable: true });
  const hidden = frame(); Object.defineProperty(hidden.crop, 'x', { value: 0, enumerable: false });
  const symbol = frame(); symbol[Symbol('hidden')] = true;
  const proto = Object.assign(Object.create({}), frame());
  for (const r of [accessor, hidden, symbol, proto, frame({ quarterTurns: NaN }), frame({ quarterTurns: 4 }), frame({ flipY: 0 }), frame({ crop: { x: 0, y: 0, w: Infinity, h: 1 } })]) assert.throws(() => G.validate(r));
  const im = picture(2, 3); Object.defineProperty(im, 'data', { get() { reads++; return new Uint8ClampedArray(24); }, enumerable: true });
  assert.throws(() => G.apply(im, null));
  assert.equal(reads, 0);
});

for (const target of ['recipe', 'crop', 'image', 'point']) test(`mandatory ${target} fields cannot be inherited from Object.prototype getters`, () => {
  const result = isolatedGeometry(`(() => {
    const recipe = MintGeometry.defaults(), image = {width:2,height:3,data:new Uint8ClampedArray(24)}, point = {x:0,y:0};
    const target = ${JSON.stringify(target)}, key = target === 'recipe' ? 'quarterTurns' : target === 'crop' || target === 'point' ? 'x' : 'width';
    const object = target === 'recipe' ? recipe : target === 'crop' ? recipe.crop : target === 'image' ? image : point;
    delete object[key]; let reads = 0, rejected = false;
    Object.defineProperty(Object.prototype, key, {configurable:true,get(){reads++;return key==='width'?2:key==='quarterTurns'?1:0;}});
    try { if(target==='image')MintGeometry.apply(image,recipe);else if(target==='point')MintGeometry.mapPoint(2,3,recipe,point);else MintGeometry.validate(recipe); } catch { rejected = true; }
    finally { delete Object.prototype[key]; } return {reads,rejected};
  })()`);
  assert.equal(result.rejected, true, 'Missing own mandatory field must be rejected');
  assert.equal(result.reads, 0, 'Inherited getter must not execute');
});

test('optional geometry cancellation never consults inherited getters or callbacks', () => {
  const result = isolatedGeometry(`(() => {
    let reads=0,calls=0;Object.defineProperty(Object.prototype,'shouldCancel',{configurable:true,get(){reads++;return()=>{calls++;return false;}}});
    let output;try{output=MintGeometry.apply({width:1,height:1,data:new Uint8ClampedArray([1,2,3,4])},null,{});}finally{delete Object.prototype.shouldCancel;}
    return {reads,calls,pixel:Array.from(output.data)};
  })()`);
  assert.equal(result.reads, 0); assert.equal(result.calls, 0); assert.deepEqual(Array.from(result.pixel), [1, 2, 3, 4]);
});

test('binary validation rejects wrong length/type, shared/detached memory and oversized pre-crop sources', () => {
  for (const data of [new Uint8ClampedArray(3), new Uint8ClampedArray(5), new Float32Array(4), new Uint16Array(4), [1, 2, 3, 4], new DataView(new ArrayBuffer(4)), new Uint8Array(new SharedArrayBuffer(4))]) assert.throws(() => G.apply({ width: 1, height: 1, data }, null));
  const data = new Uint8Array([1, 2, 3, 4]); structuredClone(data.buffer, { transfer: [data.buffer] }); assert.throws(() => G.apply({ width: 1, height: 1, data }, null));
  const tiny = frame({ crop: { x: 0, y: 0, w: 1e-6, h: 1e-6 } });
  for (const [w, h] of [[32769, 1], [9000, 9000], [Infinity, 1], [0, 1], [2.5, 1]]) assert.throws(() => G.plan(w, h, tiny));
  assert.throws(() => G.apply({ width: 8193, height: 8192, data: new Uint8Array(4) }, tiny), /budget/);
  assert.deepEqual(G.plan(10000, 8000, tiny).outputSize, { width: 1, height: 1 });
  const backing = new Uint8Array([90, 91, 1, 2, 3, 4, 92, 93]), out = G.apply({ width: 1, height: 1, data: backing.subarray(2, 6) }, null);
  assert.deepEqual(Array.from(out.data), [1, 2, 3, 4]); assert.deepEqual(Array.from(backing), [90, 91, 1, 2, 3, 4, 92, 93]);
});

test('pre-allocation, row-boundary and final cancellation expose no partial result and preserve source', () => {
  const im = picture(5, 35), before = im.data.slice();
  for (const stop of [1, 2, 3, 4, 5]) { let calls = 0; assert.throws(() => G.apply(im, frame(), { shouldCancel: () => ++calls === stop }), /cancel/i); assert.equal(calls, stop); assert.deepEqual(im.data, before); }
  let calls = 0; const out = G.apply(im, frame(), { shouldCancel: () => { calls++; return false; } });
  assert.equal(calls, 5); assert.deepEqual(out, im);
  assert.throws(() => G.apply(im, null, { shouldCancel() { throw new Error('callback-failure'); } }), /callback-failure/); assert.deepEqual(im.data, before);
});

test('crop cannot bypass any native 16MP complex-effect class or the 64MP/edge source ceiling', () => {
  const framing = frame({ crop: { x: 0, y: 0, w: .001, h: .001 }, quarterTurns: 1 });
  const effects = [...Core.FACE_KEYS.map(k => ({ [k]: 1 })), { spots: [{ x: .5, y: .5, r: .01 }] }, { bgMode: 'transparent' }, { learnedMatteId: 'matte' }, { manualLiquify: [{}] }, { manualRepair: [{}] }, { localLayers: [{ mask: { kind: 'selection' } }] }];
  for (const extra of effects) assert.throws(() => Core.sizePlan(16000, 1001, 'original', settings({ framing, ...extra })), /1600/);
  for (const [w, h] of [[8001, 8000], [16385, 1]]) for (const mode of ['original', 'working']) assert.throws(() => Core.sizePlan(w, h, mode, settings({ framing })), /6400|16384/);
  const exact = Core.sizePlan(8000, 8000, 'original', settings({ framing })); assert.equal(exact.processingWidth, 8000); assert.equal(exact.scaled, false); assert.equal(exact.framed, true); assert.deepEqual([exact.width, exact.height], [8, 8]);
});

test('real selected-region edit then framing preserves outside pixels, alpha, source bytes and recipe snapshots', async () => {
  const im = picture(43, 31), framing = frame({ crop: { x: .07, y: .1, w: .83, h: .8 }, quarterTurns: 3, flipX: true });
  const selection = { version: 1, sourceRevision: REV, base: 'none', inverted: false, feather: 0, commands: [{ kind: 'lasso', mode: 'add', points: [{ x: .3, y: .25 }, { x: .65, y: .25 }, { x: .65, y: .7 }, { x: .3, y: .7 }] }] };
  const s = settings({ framing, manualSelection: selection, localLayers: [{ id: 'selected', name: 'selected only', enabled: true, opacity: 1, sourceRevision: REV, adjustments: { exposure: 30, contrast: 0, saturation: 0, temperature: 0 }, mask: { kind: 'selection', selection } }] });
  const before = structuredClone(s), original = im.data.slice(), edited = Core.processPixels(im, { ...s, framing: null }, { landmarks: [], sourceRevision: REV }), expected = oracle(edited, framing), mask = Manual.rasterizeSelection(im.width, im.height, selection, { sourceRevision: REV });
  let protectedPixels = 0, changedPixels = 0;
  for (let i = 0; i < mask.length; i++) { assert.equal(edited.data[i * 4 + 3], original[i * 4 + 3]); if (mask[i] === 0) { assert.deepEqual(edited.data.subarray(i * 4, i * 4 + 4), original.subarray(i * 4, i * 4 + 4)); protectedPixels++; } else if (edited.data[i * 4] !== original[i * 4]) changedPixels++; }
  assert.ok(protectedPixels > 500 && changedPixels > 50);
  assert.deepEqual(Core.processPixels(im, s, { landmarks: [], sourceRevision: REV }), expected); assert.deepEqual(pixelWorker(im, s), expected);
  const bytes = await png(im), hash = sha(bytes), out = await nativeExport(request(bytes, { settings: s }));
  for (let i = 0; i < expected.data.length; i += 4) if (expected.data[i + 3] === 0) expected.data[i] = expected.data[i + 1] = expected.data[i + 2] = 0;
  assert.deepEqual(await sharp(out.bytes).ensureAlpha().raw().toBuffer(), Buffer.from(expected.data));
  assert.deepEqual([out.width, out.height], [expected.width, expected.height]); assert.equal(out.scaled, false); assert.equal(sha(bytes), hash); assert.deepEqual(s, before); assert.deepEqual(im.data, original);
});

function photo(bytes) { const s = settings({ framing: frame({ crop: { x: .1, y: .2, w: .8, h: .6 }, quarterTurns: 1 }) }); return { id: 'independent', name: 'fixture.png', sourceRevision: REV, source: { bytes: new Uint8Array(bytes), mime: 'image/png', width: 10, height: 8 }, settings: s, committed: structuredClone(s), undo: [structuredClone(s)], redo: [structuredClone(s)], selected: true, revision: 3, preset: null, imageAssets: [], learnedCache: [], exportedSettings: structuredClone(s) }; }
function rewrittenProject(bytes, edit) { const h = P.inspectHeader(bytes), doc = JSON.parse(Buffer.from(bytes.subarray(64, 64 + h.metadataBytes)).toString('utf8')); edit(doc); const json = Buffer.from(JSON.stringify(historicalImageFields(doc))), header = Buffer.from(bytes.subarray(0, 64)), payload = Buffer.from(bytes.subarray(64 + h.metadataBytes)); header.writeUInt32LE(doc.version, 8); header.writeUInt32LE(json.length, 16); header.writeUInt32LE(64 + json.length + payload.length, 24); Buffer.from(sha(json), 'hex').copy(header, 32); return Buffer.concat([header, json, payload]); }
const snapshots = p => [p.settings, p.committed, ...p.undo, ...p.redo, p.exportedSettings];

test('project rejects malformed framing in every snapshot, including otherwise-unused redo/exported state', async () => {
  const bytes = await png(picture(10, 8)), valid = await P.encode({ version: P.VERSION, currentId: 'independent', photos: [photo(bytes)] });
  for (let i = 0; i < 5; i++) {
    const p = photo(bytes); snapshots(p)[i].framing.flipX = 'false'; await assert.rejects(P.encode({ version: P.VERSION, currentId: p.id, photos: [p] }), /framing/i);
    const invalid = rewrittenProject(valid, d => { snapshots(d.photos[0])[i].framing.quarterTurns = 9; }); await assert.rejects(P.decode(invalid), /framing/i);
  }
  const restored = await P.decode(valid); const all = snapshots(restored.photos[0]); all[0].framing.crop.x = .9; for (const s of all.slice(1)) assert.equal(s.framing.crop.x, .1); assert.deepEqual(restored.photos[0].source.bytes, new Uint8Array(bytes));
});

test('v4 valid source and all history snapshots migrate without adding framing or mutating source', async () => {
  const bytes = await png(picture(10, 8)), valid = await P.encode({ version: 5, currentId: 'independent', photos: [photo(bytes)] }), old = rewrittenProject(valid, d => { d.version = 4; delete d.photos[0].review; for (const s of snapshots(d.photos[0])) { delete s.framing; s.exposure = 7; } }), before = sha(old), restored = await P.decode(old);
  assert.equal(restored.version, P.VERSION); for (const s of snapshots(restored.photos[0])) { assert.equal(s.framing, null); assert.equal(s.exposure, 7); } assert.deepEqual(restored.photos[0].source.bytes, new Uint8Array(bytes)); assert.equal(sha(old), before);
});

test('project settings with active framing fail closed when geometry validator is missing', () => {
  const ctx = vm.createContext({ TextEncoder, TextDecoder }); vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/project-document.cjs'), 'utf8'), ctx);
  assert.throws(() => vm.runInContext(`MintProjectDocument.validateSettings({...MintProjectDocument.DEFAULT_SETTINGS,framing:{version:1,crop:{x:0,y:0,w:1,h:1},quarterTurns:1,flipX:false,flipY:false}},{width:7,height:3},'test:0')`, ctx), /Geometry.*unavailable/);
  assert.doesNotThrow(() => vm.runInContext(`MintProjectDocument.validateSettings({...MintProjectDocument.DEFAULT_SETTINGS},{width:7,height:3},'test:0')`, ctx));
});

for (const field of ['width', 'height', 'processingWidth', 'processingHeight', 'originalWidth', 'originalHeight', 'scaled', 'framed']) test(`native export rejects forged ${field} and releases its worker`, async () => {
  const source = await png(picture(7, 3, false)), framing = frame({ quarterTurns: 1 }), encoded = await png(oracle(picture(7, 3, false), framing)); let terminated = 0;
  class Forged extends EventEmitter { constructor(_, { workerData }) { super(); queueMicrotask(() => { const result = { ok: true, bytes: new Uint8Array(encoded), ...workerData.plan }; result[field] = typeof result[field] === 'boolean' ? !result[field] : result[field] + 1; this.emit('message', result); }); } terminate() { terminated++; return Promise.resolve(0); } }
  const service = createExportRenderer({ WorkerClass: Forged }); try { await assert.rejects(service.render(request(source, { settings: settings({ framing }) })), /校验|尺寸|结果/); assert.equal(service.isBusy(), false); assert.equal(terminated, 1); } finally { service.dispose(); }
});

test('native export rejects stale encoded dimensions even when every returned plan field is forged to match', async () => {
  const bytes = await png(picture(7, 3, false)); let stopped = 0;
  class Stale extends EventEmitter { constructor(_, { workerData }) { super(); queueMicrotask(() => this.emit('message', { ok: true, bytes: new Uint8Array(bytes), ...workerData.plan })); } terminate() { stopped++; return Promise.resolve(0); } }
  const service = createExportRenderer({ WorkerClass: Stale }); try { await assert.rejects(service.render(request(bytes, { settings: settings({ framing: frame({ quarterTurns: 1 }) }) })), /校验|尺寸|结果/); assert.equal(service.isBusy(), false); assert.equal(stopped, 1); } finally { service.dispose(); }
});

test('native framed cancellation waits for termination, ignores late success, then permits a new job', async () => {
  const bytes = await png(picture(7, 3, false)), framing = frame({ quarterTurns: 1 }), encoded = await png(oracle(picture(7, 3, false), framing)), workers = [];
  let release; const termination = new Promise(resolve => { release = resolve; });
  class Controlled extends EventEmitter { constructor(_, { workerData }) { super(); this.request = workerData; this.stops = 0; workers.push(this); } terminate() { this.stops++; return workers.indexOf(this) === 0 ? termination : Promise.resolve(0); } finish() { this.emit('message', { ok: true, bytes: new Uint8Array(encoded), ...this.request.plan }); } }
  const service = createExportRenderer({ WorkerClass: Controlled });
  try { const pending = service.render(request(bytes, { settings: settings({ framing }) })), rejection = assert.rejects(pending, { name: 'AbortError' }); assert.equal(service.cancel('unrelated'), false); assert.equal(service.cancel('independent-frame'), true); assert.equal(service.isBusy(), true); workers[0].finish(); await assert.rejects(service.render(request(bytes, { requestId: 'second' })), /已有/); release(0); await rejection; assert.equal(service.isBusy(), false); const fresh = service.render(request(bytes, { requestId: 'fresh', settings: settings({ framing }) })); workers[0].finish(); workers[1].finish(); assert.equal((await fresh).width, 3); assert.equal(workers[0].stops, 1); assert.equal(workers[1].stops, 1); } finally { release(0); service.dispose(); }
});

test('native geometry worker error and premature exit release capacity and never publish a result', async () => {
  const bytes = await png(picture(7, 3, false)), workers = [];
  class Controlled extends EventEmitter { constructor() { super(); this.stops = 0; workers.push(this); } terminate() { this.stops++; return Promise.resolve(0); } }
  const service = createExportRenderer({ WorkerClass: Controlled });
  try { const a = service.render(request(bytes, { settings: settings({ framing: frame({ flipY: true }) }) })), rejectA = assert.rejects(a, /geometry-test-failure/); workers[0].emit('error', new Error('geometry-test-failure')); await rejectA; assert.equal(service.isBusy(), false); const b = service.render(request(bytes)), rejectB = assert.rejects(b, /提前退出/); workers[1].emit('exit', 7); await rejectB; assert.equal(service.isBusy(), false); assert.ok(workers.every(w => w.stops === 1)); } finally { service.dispose(); }
});

test('source pipeline rejects stale unframed or forged RGBA dimensions, terminates workers and drains queued work', async () => {
  const h = pipelineHarness(), source = new h.Canvas(), s = settings({ framing: frame({ quarterTurns: 1 }) });
  const a = h.api.render(source, s), b = h.api.render(source, s), c = h.api.render(source, s), ra = assert.rejects(a, /尺寸/), rb = assert.rejects(b, /尺寸/);
  h.workers[0].finish({ width: 7, height: 3, buffer: new ArrayBuffer(84) }); h.workers[1].finish({ width: 3, height: 7, buffer: new ArrayBuffer(80) }); await Promise.all([ra, rb]); await Promise.resolve(); assert.equal(h.workers.length, 3); h.workers[2].correct(); const out = await c; assert.deepEqual([out.width, out.height], [3, 7]); assert.ok(h.workers.every(w => w.terminated)); assert.deepEqual(source.pixels, picture(7, 3).data);
});

test('queued framing is snapshotted; cancellation drops old results and preserves fresh source-coordinate editing', async () => {
  const h = pipelineHarness(), source = new h.Canvas(), s = settings({ framing: frame({ quarterTurns: 1 }) }), controller = new AbortController();
  const a = h.api.render(source, s, null, { signal: controller.signal }), b = h.api.render(source, s), c = h.api.render(source, s), rejected = assert.rejects(a, { name: 'AbortError' }); s.framing.quarterTurns = 2; controller.abort(); await rejected; await Promise.resolve(); assert.equal(h.workers[2].input.settings.framing.quarterTurns, 1); h.workers[0].correct(); h.workers[1].correct(); h.workers[2].correct(); const outputs = await Promise.all([b, c]); assert.ok(outputs.every(out => out.width === 3 && out.height === 7));
  const sourceView = h.api.render(source, s, null, { sourceView: true }); assert.equal(h.workers[3].input.settings.framing, null); h.workers[3].correct(); assert.equal((await sourceView).width, 7);
  const manualView = h.api.render(source, s, null, { manualEditing: true }); assert.equal(h.workers[4].input.settings.framing, null); h.workers[4].correct(); assert.equal((await manualView).width, 7); assert.equal(s.framing.quarterTurns, 2); assert.ok(h.workers.every(w => w.terminated));
});

test('missing geometry core and pre-aborted framed work allocate no workers or source copies', async () => {
  const h = pipelineHarness({ withGeometry: false }), source = new h.Canvas(), s = settings({ framing: frame({ flipX: true }) }); await assert.rejects(h.api.render(source, s), /不可用/); assert.equal(h.workers.length, 0); assert.equal(source.reads, 0);
  const normal = pipelineHarness(), canvas = new normal.Canvas(), signal = new AbortController(); signal.abort(); await assert.rejects(normal.api.render(canvas, s, null, { signal: signal.signal }), { name: 'AbortError' }); assert.equal(normal.workers.length, 0); assert.equal(canvas.reads, 0);
});

test('source pixel worker matches the independent oracle for all sixteen non-square crop/turn/flip combinations', () => {
  const im = picture(19, 11), before = im.data.slice();
  for (let q = 0; q < 4; q++) for (const flipX of [false, true]) for (const flipY of [false, true]) {
    const framing = frame({ crop: { x: 2.5 / 19, y: 1.5 / 11, w: 12 / 19, h: 7 / 11 }, quarterTurns: q, flipX, flipY });
    assert.deepEqual(pixelWorker(im, settings({ framing })), oracle(im, framing));
  }
  assert.deepEqual(im.data, before);
});

test('actual PNG workers produce independent expected pixels for all turn/flip combinations and 1px outputs', async () => {
  for (const [width, height] of [[11, 7], [1, 9], [8, 1]]) {
    const im = picture(width, height), bytes = await png(im), before = sha(bytes);
    for (let quarterTurns = 0; quarterTurns < 4; quarterTurns++) for (const flipX of [false, true]) for (const flipY of [false, true]) {
      const framing = frame({ crop: { x: .15, y: .2, w: .75, h: .65 }, quarterTurns, flipX, flipY }), expected = oracle(im, framing), out = await nativeExport(request(bytes, { settings: settings({ framing }) }));
      for (let i = 0; i < expected.data.length; i += 4) if (expected.data[i + 3] === 0) expected.data[i] = expected.data[i + 1] = expected.data[i + 2] = 0;
      assert.deepEqual(await sharp(out.bytes).ensureAlpha().raw().toBuffer(), Buffer.from(expected.data));
      assert.deepEqual([out.width, out.height], [expected.width, expected.height]);
      assert.deepEqual([out.originalWidth, out.originalHeight, out.processingWidth, out.processingHeight], [width, height, width, height]);
      assert.equal(out.scaled, false); assert.equal(out.framed, true); assert.equal(out.details.resampling, 'none');
    }
    assert.equal(sha(bytes), before);
  }
});

test('explicit working resize precedes independent integer framing; original mode stays unscaled', async () => {
  const im = picture(4103, 13, false), bytes = await png(im), before = sha(bytes), framing = frame({ crop: { x: .125, y: .15, w: .6, h: .7 }, quarterTurns: 3, flipY: true }), s = settings({ framing });
  for (const mode of ['original', 'working']) {
    const width = mode === 'working' ? 4096 : im.width, height = 13;
    const processed = mode === 'working' ? new Uint8ClampedArray(await sharp(bytes).ensureAlpha().resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer()) : im.data;
    const expected = oracle({ width, height, data: processed }, framing), out = await nativeExport(request(bytes, { settings: s, mode }));
    assert.deepEqual(await sharp(out.bytes).ensureAlpha().raw().toBuffer(), Buffer.from(expected.data));
    assert.deepEqual([out.width, out.height, out.processingWidth, out.processingHeight], [expected.width, expected.height, width, height]);
    assert.equal(out.scaled, mode === 'working'); assert.equal(out.framed, true);
  }
  assert.equal(sha(bytes), before);
});

test('actual JPEG framing produces planned dimensions, opaque white flattening, stripped orientation and unchanged source', async () => {
  const im = picture(19, 11), bytes = await png(im), before = sha(bytes), framing = frame({ crop: { x: .1, y: .1, w: .8, h: .8 }, quarterTurns: 1, flipX: true }), expected = oracle(im, framing);
  const out = await nativeExport(request(bytes, { format: 'jpeg', quality: 1, settings: settings({ framing }) })), metadata = await sharp(out.bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], [expected.width, expected.height]); assert.equal(metadata.hasAlpha, false); assert.equal(metadata.orientation, undefined); assert.equal(metadata.exif, undefined); assert.equal(out.scaled, false); assert.equal(sha(bytes), before);
  const raw = await sharp(out.bytes).raw().toBuffer(); let transparent = 0;
  for (let i = 0; i < expected.width * expected.height; i++) if (expected.data[i * 4 + 3] === 0) { transparent++; for (let c = 0; c < 3; c++) assert.ok(raw[i * 3 + c] >= 245, 'Transparent pixels should flatten close to white at JPEG quality 100'); }
  assert.ok(transparent > 0);
});

test('native result guard rejects empty/truncated/mismatched-format output and JPEG header dimensions', async () => {
  const im = picture(7, 3, false), bytes = await png(im), framing = frame({ quarterTurns: 1 }), correct = await png(oracle(im, framing));
  const jpegWrongSize = await sharp(bytes).jpeg().toBuffer();
  const cases = [
    { format: 'png', result: new Uint8Array(0) },
    { format: 'png', result: new Uint8Array(correct.subarray(0, 24)) },
    { format: 'jpeg', result: new Uint8Array(correct) },
    { format: 'png', result: new Uint8Array(jpegWrongSize) },
    { format: 'jpeg', result: new Uint8Array(jpegWrongSize) }
  ];
  for (const c of cases) {
    let terminated = 0;
    class Forged extends EventEmitter { constructor(_, { workerData }) { super(); queueMicrotask(() => this.emit('message', { ok: true, bytes: c.result, ...workerData.plan })); } terminate() { terminated++; return Promise.resolve(0); } }
    const service = createExportRenderer({ WorkerClass: Forged });
    try { await assert.rejects(service.render(request(bytes, { format: c.format, settings: settings({ framing }) })), /校验/); assert.equal(service.isBusy(), false); assert.equal(terminated, 1); } finally { service.dispose(); }
  }
});

test('oversized encoded original is rejected before spawning a native worker even with a 1px crop', async () => {
  const bytes = Buffer.from(await png(picture(7, 3, false))); bytes.writeUInt32BE(8001, 16); bytes.writeUInt32BE(8000, 20); let started = 0;
  class Forbidden { constructor() { started++; throw new Error('Worker must not be created'); } }
  const service = createExportRenderer({ WorkerClass: Forbidden });
  try { await assert.rejects(service.render(request(bytes, { settings: settings({ framing: frame({ crop: { x: 0, y: 0, w: 1e-8, h: 1e-8 } }) }) })), /6400/); assert.equal(started, 0); assert.equal(service.isBusy(), false); } finally { service.dispose(); }
});

test('actual native framed render can be cancelled without detaching source bytes and then recover', async () => {
  const bytes = await png(picture(1024, 513, false)), before = sha(bytes), service = createExportRenderer(), framing = frame({ crop: { x: .1, y: .1, w: .8, h: .8 }, quarterTurns: 3 });
  try {
    const running = service.render(request(bytes, { settings: settings({ framing }) })); assert.equal(service.cancel('independent-frame'), true); await assert.rejects(running, { name: 'AbortError' }); assert.equal(service.isBusy(), false); assert.equal(sha(bytes), before);
    const small = await png(picture(7, 3, false)), out = await service.render(request(small, { requestId: 'after-native-cancel', settings: settings({ framing: frame({ quarterTurns: 1 }) }) })); assert.deepEqual([out.width, out.height], [3, 7]); assert.equal(service.cancel('after-native-cancel'), false);
  } finally { service.dispose(); }
});
