'use strict';
// Rehashed historical frames must not inherit newly introduced v16 fields.
function historicalImageFields(doc) {
  if (doc.format === 'mint-portrait-project' && doc.version < 16) for (const photo of doc.photos) {
    delete photo.imageAssets;
    for (const state of [photo.settings, photo.committed, ...photo.undo, ...photo.redo, photo.exportedSettings].filter(Boolean)) delete state.imageLayers;
  }
  return doc;
}

// Independent QA. Runs actual shipped worker source in a Node VM and actual native
// export worker threads with Sharp decode/readback. This is NOT native browser/UI QA.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), crypto = require('node:crypto'), sharp = require('sharp');
const L = require('../src/levels.cjs'), P = require('../src/project-document.cjs'), Tone = require('../src/advanced-tone.cjs'), Local = require('../src/local-adjustments.cjs'), Manual = require('../src/manual-pipeline.cjs'), Portrait = require('../src/portrait-engine.cjs'), Geometry = require('../src/geometry.cjs');
const Core = require('../export-render-core.cjs'), { createExportRenderer } = require('../export-renderer.cjs'), { createProjectStore } = require('../project-store.cjs'), { createPresetStore } = require('../preset-store.cjs'), { createCodec } = require('../src/preset-codec.cjs');
const { keys, neutral, recipe, transfer, scalar, oracle, picture } = require('../quality/levels-qa/oracle.cjs');
const ROOT = path.resolve(__dirname, '..'), REV = 'levels-independent:0';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const settings = extra => ({ ...structuredClone(P.DEFAULT_SETTINGS), ...extra });
const png = im => sharp(Buffer.from(im.data), { raw: { width: im.width, height: im.height, channels: 4 } }).png().toBuffer();
function isolated(code) { const c = vm.createContext({}); vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/levels.cjs'), 'utf8'), c); return vm.runInContext(code, c); }
function worker(image, s, analysis = { landmarks: [], sourceRevision: REV }) {
  let response;
  const c = vm.createContext({ bytes: Array.from(image.data), width: image.width, height: image.height, serialized: JSON.stringify(s), facts: JSON.stringify({ ...analysis, mask: analysis.mask ? { ...analysis.mask, data: Array.from(analysis.mask.data) } : undefined }), self: { postMessage: r => { response = r; } } });
  c.importScripts = (...names) => { for (const name of names) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', name), 'utf8'), c); };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/pixel-worker.js'), 'utf8'), c);
  vm.runInContext(`const analysis=JSON.parse(facts);if(analysis.mask)analysis.mask.data=Float32Array.from(analysis.mask.data);self.onmessage({data:{width,height,buffer:Uint8ClampedArray.from(bytes).buffer,settings:JSON.parse(serialized),analysis}});`, c);
  assert.ok(response); if (response.error) throw new Error(response.error);
  return { width: response.width, height: response.height, data: new Uint8ClampedArray(response.buffer) };
}
function combined() {
  const advancedTone = Tone.defaults(); advancedTone.curves.rgb = [0, .18, .55, .84, 1]; advancedTone.hsl[4] = { hue: 17, saturation: -23, luminance: 11 };
  return settings({ exposure: 11, contrast: 13, saturation: -7, levels: recipe(), advancedTone,
    localLayers: [{ id: 'radial', name: 'Local noncommuting', enabled: true, opacity: .7, sourceRevision: REV, adjustments: { exposure: 29, contrast: 9, saturation: -17, temperature: 13 }, mask: { kind: 'radial', cx: .51, cy: .49, rx: .3, ry: .37, feather: .6 } }],
    manualRepair: [{ version: 1, type: 'repair-stroke', mode: 'clone', sourceRevision: REV, radius: .055, hardness: .31, strength: .74, points: [{ x: .61, y: .53 }, { x: .66, y: .57 }], source: { x: .28, y: .29 }, sampleMode: 'manual', selection: null }],
    framing: { version: 1, crop: { x: .13, y: .07, w: .72, h: .79 }, quarterTurns: 1, flipX: true, flipY: false }
  });
}
function expectedPipeline(im, s, analysis) {
  let out = Local.tone(im, s); out = oracle(out, s.levels);
  if (s.advancedTone) out = Tone.apply(out, s.advancedTone);
  if (s.localLayers.length) out = Local.apply(out, s.localLayers, analysis);
  out = Manual.apply(out, s, { sourceRevision: REV });
  if (s.bgMode !== 'original') out = Portrait.background(out, { mode: s.bgMode, blur: s.bgBlur, color: s.bgColor, feather: s.bgFeather, mask: analysis.mask });
  if (['slim', 'eyes', 'nose', 'jaw'].some(k => s[k])) for (const face of analysis.landmarks) out = Portrait.reshape(out, s, face);
  if (s.framing) out = Geometry.apply({ width: out.width, height: out.height, data: out.data }, s.framing);
  return out;
}
async function exportPng(image, s, analysis = { landmarks: [], sourceRevision: REV }) {
  const bytes = await png(image), originalHash = sha(bytes), service = createExportRenderer();
  try { const result = await service.render({ requestId: 'levels-independent', bytes, sourceRevision: REV, settings: s, analysis, mode: 'original', format: 'png', quality: .9 }); const { data, info } = await sharp(Buffer.from(result.bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); assert.equal(sha(bytes), originalHash); return { result, data, info }; }
  finally { service.dispose(); }
}
function photo(image, bytes) {
  return { id: 'levels-photo', name: 'synthetic.png', sourceRevision: REV, source: { bytes: new Uint8Array(bytes), mime: 'image/png', width: image.width, height: image.height }, selected: true, settings: settings({ levels: recipe() }), committed: settings({ levels: recipe() }), undo: [settings(), settings({ levels: { ...recipe(), strength: 0 } })], redo: [settings({ levels: neutral() })], exportedSettings: settings({ levels: recipe() }), revision: 5, preset: null, learnedCache: [], review: { version: 1, current: { rating: 4, flag: 'pick', label: 'green' }, undo: [{ rating: 0, flag: 'none', label: 'none' }], redo: [] } };
}
const slots = p => [p.settings, p.committed, ...p.undo, ...p.redo, ...(p.exportedSettings ? [p.exportedSettings] : [])];
function rewriteProject(bytes, mutate, version = 7) {
  const h = P.inspectHeader(bytes), doc = JSON.parse(Buffer.from(bytes.subarray(64, 64 + h.metadataBytes)).toString('utf8'));
  doc.version = version; mutate(doc); const metadata = Buffer.from(JSON.stringify(historicalImageFields(doc))), header = Buffer.from(bytes.subarray(0, 64)), payload = Buffer.from(bytes.subarray(64 + h.metadataBytes));
  header.writeUInt32LE(version, 8); header.writeUInt32LE(metadata.length, 16); header.writeUInt32LE(64 + metadata.length + payload.length, 24); Buffer.from(sha(metadata), 'hex').copy(header, 32);
  return Buffer.concat([header, metadata, payload]);
}
async function fixture(t) { const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mint-levels-independent-')); t.after(() => fsp.rm(dir, { recursive: true, force: true })); return dir; }

test('independent Levels: neutral defaults are individually owned; null, default and zero strength are exact identities', () => {
  assert.deepEqual(L.defaults(), neutral()); const a = L.defaults(), b = L.defaults(); a.channels.rgb.gamma = 2; assert.equal(b.channels.rgb.gamma, 1); assert.equal(a.channels.red.gamma, 1);
  const im = picture(256, 6, true), before = im.data.slice();
  for (const r of [null, neutral(), { ...recipe(), strength: 0 }]) { assert.equal(L.isActive(r), false); assert.equal(L.apply(im, r), im); assert.deepEqual(L.apply(im, r).data, before); for (const table of Object.values(L.buildLuts(r))) assert.deepEqual([...table], Array.from({ length: 256 }, (_, n) => n)); }
  assert.equal(L.isActive(recipe()), true); assert.deepEqual(im.data, before);
});
test('independent Levels: all 256 codes match scalar reference across 800 seeded full recipes', () => {
  let seed = 0x438e219b; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let n = 0; n < 800; n++) { const r = neutral(); r.strength = n % 17 === 0 ? 0 : n % 19 === 0 ? 1 : random(); for (const key of keys) { const b = Math.floor(random() * 255), w = b + 1 + Math.floor(random() * (255 - b)), ob = Math.floor(random() * 256), ow = ob + Math.floor(random() * (256 - ob)); r.channels[key] = { inputBlack: b, inputWhite: w, gamma: n % 23 === 0 ? .1 : n % 29 === 0 ? 10 : .1 + random() * 9.9, outputBlack: ob, outputWhite: ow }; } const lut = L.buildLuts(r); for (const key of keys.slice(1)) for (let value = 0; value < 256; value++) { assert.equal(lut[key][value], scalar(value, key, r), `recipe ${n}, ${key}, code ${value}`); if (value) assert.ok(lut[key][value] >= lut[key][value - 1]); } }
});
test('independent Levels: gamma direction, clipping, flat outputs and exact half-up blend ties', () => {
  const r = neutral(); r.channels.rgb.gamma = 2; assert.ok(L.buildLuts(r).red[64] > 64); r.channels.rgb.gamma = .5; assert.ok(L.buildLuts(r).red[64] < 64);
  Object.assign(r.channels.rgb, { inputBlack: 20, inputWhite: 200, gamma: 1, outputBlack: 31, outputWhite: 219 }); assert.equal(L.buildLuts(r).red[20], 31); assert.equal(L.buildLuts(r).red[200], 219);
  r.channels.rgb.outputWhite = 31; r.strength = .5; const lut = L.buildLuts(r); assert.equal(lut.red[0], 16); assert.equal(lut.red[2], 17); assert.equal(lut.red[255], 143);
});
test('independent Levels: composition has no intermediate rounding, and strength is blended only once', () => {
  const r = recipe(), lut = L.buildLuts(r); let differsFromRoundedMaster = 0, differsFromDoubleBlend = 0;
  for (const key of keys.slice(1)) for (let value = 0; value < 256; value++) {
    const master = transfer(value, r.channels.rgb), rounded = transfer(Math.round(master), r.channels[key]);
    if (Math.round(value + (rounded - value) * r.strength) !== lut[key][value]) differsFromRoundedMaster++;
    const blendedMaster = value + (master - value) * r.strength, twice = blendedMaster + (transfer(blendedMaster, r.channels[key]) - blendedMaster) * r.strength;
    if (Math.round(twice) !== lut[key][value]) differsFromDoubleBlend++;
  }
  assert.ok(differsFromRoundedMaster > 20); assert.ok(differsFromDoubleBlend > 20);
});
test('independent Levels: red-only adjustment never leaks into green/blue; master preserves neutral grays', () => {
  const im = picture(256, 6, true), r = neutral(); r.channels.red.gamma = 1.7; const out = L.apply(im, r);
  for (let i = 0; i < im.data.length; i += 4) { assert.equal(out.data[i + 1], im.data[i + 1]); assert.equal(out.data[i + 2], im.data[i + 2]); assert.equal(out.data[i + 3], im.data[i + 3]); }
  const master = neutral(); master.channels.rgb = recipe().channels.rgb; const luts = L.buildLuts(master); assert.deepEqual(luts.red, luts.green); assert.deepEqual(luts.red, luts.blue);
});
test('independent Levels: visible alpha and alpha-zero hidden RGB are untouched; output and validation do not alias input', () => {
  const im = picture(129, 97, true), before = im.data.slice(), r = recipe(), beforeRecipe = structuredClone(r), out = L.apply(im, r), copy = L.validate(r);
  assert.deepEqual(out, oracle(im, r)); assert.deepEqual(im.data, before); assert.deepEqual(r, beforeRecipe); assert.notEqual(out.data.buffer, im.data.buffer);
  for (let i = 0; i < im.data.length; i += 4) { assert.equal(out.data[i + 3], im.data[i + 3]); if (!im.data[i + 3]) assert.deepEqual(out.data.subarray(i, i + 4), im.data.subarray(i, i + 4)); }
  copy.channels.red.gamma = 8; assert.notEqual(r.channels.red.gamma, 8); out.data[7] = 99; assert.deepEqual(im.data, before);
});
const malformed = [r => { r.version = 2; }, r => { r.strength = NaN; }, r => { r.strength = 1.01; }, r => { r.strength = -.01; }, r => { r.channels.rgb.inputBlack = -1; }, r => { r.channels.rgb.inputWhite = 256; }, r => { r.channels.red.inputBlack = 2.5; }, r => { r.channels.green.inputWhite = r.channels.green.inputBlack; }, r => { r.channels.blue.outputBlack = 256; }, r => { r.channels.rgb.outputBlack = 3; r.channels.rgb.outputWhite = 2; }, r => { r.channels.red.gamma = .099; }, r => { r.channels.blue.gamma = 10.01; }, r => { r.channels.green.gamma = Infinity; }, r => { r.channels.green.gamma = '1'; }, r => { r.extra = true; }, r => { delete r.channels.red; }, r => { r.channels.alpha = neutral().channels.rgb; }, r => { r.channels.rgb.foo = 1; }];
for (const [i, mutate] of malformed.entries()) test(`independent Levels: malformed recipe ${i + 1} fails in validate, LUT and apply even when inactive`, () => { for (const zero of [false, true]) { const r = neutral(); if (zero) r.strength = 0; mutate(r); const im = picture(1, 1), before = im.data.slice(); assert.throws(() => L.validate(r)); assert.throws(() => L.buildLuts(r)); assert.throws(() => L.apply(im, r)); assert.deepEqual(im.data, before); } });
test('independent Levels: own accessors, hidden/symbol fields and custom prototypes fail without invoking hooks', () => {
  let reads = 0; const getter = recipe(); Object.defineProperty(getter.channels.red, 'gamma', { enumerable: true, get() { reads++; return 1; } });
  const hidden = recipe(); Object.defineProperty(hidden.channels, 'green', { value: hidden.channels.green, enumerable: false });
  const symbol = recipe(); symbol[Symbol('extra')] = true; const proto = Object.assign(Object.create({}), recipe());
  const im = picture(1, 1); Object.defineProperty(im, 'data', { enumerable: true, get() { reads++; return new Uint8Array(4); } });
  for (const r of [getter, hidden, symbol, proto, undefined, false, [], 1]) assert.throws(() => L.validate(r)); assert.throws(() => L.apply(im, null)); assert.equal(reads, 0);
});
for (const key of ['version', 'strength', 'channels', 'rgb', 'gamma']) test(`independent Levels: inherited mandatory ${key} getter cannot replace an own data field`, () => {
  const result = isolated(`(()=>{const r=MintLevels.defaults();const key=${JSON.stringify(key)},target=key==='rgb'?r.channels:key==='gamma'?r.channels.red:r;delete target[key];let calls=0,rejected=false;Object.defineProperty(Object.prototype,key,{configurable:true,get(){calls++;return 1}});try{MintLevels.validate(r)}catch{rejected=true}finally{delete Object.prototype[key]}return {calls,rejected}})()`);
  assert.equal(result.rejected, true); assert.equal(result.calls, 0);
});
test('independent Levels: inherited output setters do not capture validated channels', () => {
  const result = isolated(`(()=>{const r=MintLevels.defaults();let calls=0,out,error;Object.defineProperty(Object.prototype,'red',{configurable:true,set(){calls++}});try{out=MintLevels.validate(r)}catch(e){error=e.message}finally{delete Object.prototype.red}return {calls,error,own:out&&Object.hasOwn(out.channels,'red')}})()`);
  assert.equal(result.calls, 0); assert.equal(result.error, undefined); assert.equal(result.own, true);
});
test('independent Levels: inherited optional cancellation callback is never consulted', () => {
  const result = isolated(`(()=>{let calls=0,reads=0,out;Object.defineProperty(Object.prototype,'shouldCancel',{configurable:true,get(){reads++;return()=>{calls++;return true}}});try{out=MintLevels.apply({width:1,height:1,data:new Uint8ClampedArray([1,2,3,4])},null,{})}finally{delete Object.prototype.shouldCancel}return{reads,calls,data:Array.from(out.data)}})()`);
  assert.equal(result.reads, 0); assert.equal(result.calls, 0); assert.deepEqual([...result.data], [1, 2, 3, 4]);
});
test('independent Levels: rejects invalid image storage, shared/detached backing, options and dimensional overflow', () => {
  for (const im of [{ width: 0, height: 1, data: new Uint8Array(0) }, { width: 16385, height: 1, data: new Uint8Array(0) }, { width: 8001, height: 8000, data: new Uint8Array(0) }, { width: 1.1, height: 1, data: new Uint8Array(4) }, { width: 1, height: 1, data: [1, 2, 3, 4] }, { width: 1, height: 1, data: new Uint16Array(4) }, { width: 1, height: 1, data: new DataView(new ArrayBuffer(4)) }, { width: 1, height: 1, data: new Uint8Array(3) }, { width: 1, height: 1, data: new Uint8Array(new SharedArrayBuffer(4)) }, { width: 1, height: 1, data: new (class extends Uint8Array {})(4) }]) assert.throws(() => L.apply(im, null));
  const im = picture(1, 1); for (const opt of [null, { shouldCancel: true }, { wrong: 1 }, []]) assert.throws(() => L.apply(im, null, opt));
  const detached = picture(1, 1); structuredClone(detached.data.buffer, { transfer: [detached.data.buffer] }); assert.throws(() => L.apply(detached, null));
});
test('independent Levels: exact dimensional boundaries need no 256MB allocation when storage length fails', () => { assert.equal(L.LIMITS.pixels, 64000000); assert.equal(L.LIMITS.edge, 16384); for (const [width, height] of [[8000, 8000], [16384, 1]]) assert.throws(() => L.apply({ width, height, data: new Uint8Array(4) }, null), /buffer|length/i); assert.deepEqual(Core.sizePlan(8000, 8000, 'original', settings({ levels: recipe() })), { width: 8000, height: 8000, processingWidth: 8000, processingHeight: 8000, originalWidth: 8000, originalHeight: 8000, scaled: false, framed: false,padded:false }); });
test('independent Levels: offset Uint8Array storage is correct and shadowed accessors/methods never execute', () => {
  const raw = new Uint8Array(12); raw.set([12, 49, 213, 255], 4); const data = raw.subarray(4, 8); let calls = 0;
  for (const key of ['length', 'buffer', 'byteLength', 'byteOffset', 'slice', 'subarray', Symbol.iterator]) Object.defineProperty(data, key, { get() { calls++; throw new Error('hook'); } });
  const out = L.apply({ width: 1, height: 1, data }, recipe()); assert.deepEqual([...out.data], [...oracle({ width: 1, height: 1, data: new Uint8ClampedArray([12, 49, 213, 255]) }, recipe()).data]); assert.equal(calls, 0); assert.deepEqual([...raw], [0, 0, 0, 0, 12, 49, 213, 255, 0, 0, 0, 0]);
});
test('independent Levels: cancellation before allocation, mid-chunk and final checkpoint throws atomically', () => {
  const im = picture(1025, 97), before = sha(im.data); for (const at of [1, 2, 3, 4, 7]) { let calls = 0; assert.throws(() => L.apply(im, recipe(), { shouldCancel: () => ++calls === at }), e => e.name === 'AbortError' && e.code === 'ABORT_ERR'); assert.equal(calls, at); assert.equal(sha(im.data), before); }
  assert.throws(() => L.apply(im, null, { shouldCancel: () => true }), /cancel/i);
});
test('independent Levels: callback-induced detachment cannot publish a partial/zero-filled image', () => {
  for (const at of [1, 2, 4]) { const im = picture(64, 65); let calls = 0; assert.throws(() => L.apply(im, recipe(), { shouldCancel() { if (++calls === at) structuredClone(im.data.buffer, { transfer: [im.data.buffer] }); return false; } }), /changed|detach/i); }
});
test('independent Levels: shipped Worker and native path match independent formula, including invisible RGB', () => {
  const im = picture(257, 6, true), before = sha(im.data), s = settings({ levels: recipe() }), expected = oracle(im, s.levels);
  assert.deepEqual(Core.processPixels(im, s, { landmarks: [], sourceRevision: REV }), expected); assert.deepEqual(worker(im, s), expected); assert.equal(sha(im.data), before);
});
test('independent Levels: noncommuting basic→Levels→advanced→local→repair→frame path is byte exact', () => {
  const im = picture(), s = combined(), a = { landmarks: [], sourceRevision: REV }, expected = expectedPipeline(im, s, a), before = sha(im.data);
  assert.deepEqual(Core.processPixels(im, s, a), expected); assert.deepEqual(worker(im, s, a), expected); assert.equal(sha(im.data), before);
  const basic = Local.tone(im, s), correct = Tone.apply(oracle(basic, s.levels), s.advancedTone);
  assert.notDeepEqual(oracle(Tone.apply(basic, s.advancedTone), s.levels).data, correct.data);
  assert.notDeepEqual(Local.tone(oracle(im, s.levels), s).data, oracle(basic, s.levels).data);
  assert.notDeepEqual(oracle(Local.apply(basic, s.localLayers, a), s.levels).data, Local.apply(oracle(basic, s.levels), s.localLayers, a).data);
});
test('independent Levels: repair/background/reshape/framing use adjusted source in Worker and native export', async () => {
  const im = picture(129, 97), s = combined(); s.bgMode = 'color'; s.bgColor = '#6381ad'; s.bgFeather = 0; s.slim = 7; s.eyes = 5;
  const face = JSON.parse(fs.readFileSync(path.join(ROOT, 'quality/fixtures/victor.landmarks.json'), 'utf8')).faces[0];
  const a = { landmarks: [face], sourceRevision: REV, mask: { width: im.width, height: im.height, data: Float32Array.from({ length: im.width * im.height }, (_, n) => .15 + .8 * ((n % im.width) / (im.width - 1))) } };
  const expected = expectedPipeline(im, s, a); assert.deepEqual(Core.processPixels(im, s, a), expected); assert.deepEqual(worker(im, s, a), expected);
  const out = await exportPng(im, s, a); assert.deepEqual(out.data, Buffer.from(expected.data)); assert.equal(out.info.width, expected.width); assert.equal(out.info.height, expected.height); assert.equal(out.result.scaled, false);
});
for (const activeLevels of [false, true]) for (const rotated of [false, true]) test(`independent Levels: liquify-only diagnostics normalize at strict framing boundary (Levels=${activeLevels}, rotated=${rotated})`, async () => {
  const im = picture(129, 97), before = sha(im.data), s = settings({ levels: activeLevels ? recipe() : null, manualLiquify: [{ kind: 'push', sourceRevision: REV, radius: .2, strength: .5, points: [{ x: .35, y: .4 }, { x: .44, y: .48 }], selection: null }], manualRepair: [], framing: { version: 1, crop: { x: 0, y: 0, w: 1, h: 1 }, quarterTurns: rotated ? 1 : 0, flipX: rotated, flipY: false } }), a = { landmarks: [], sourceRevision: REV };
  const adjusted = oracle(im, s.levels), warped = Manual.apply(adjusted, s, { sourceRevision: REV });
  assert.ok(Object.hasOwn(warped, 'diagnostics'), 'Exercise actual manual output with extra diagnostics');
  assert.throws(() => Geometry.apply(warped, s.framing), /image|field/i, 'Strict geometry core still rejects non-image metadata');
  const expected = Geometry.apply({ width: warped.width, height: warped.height, data: warped.data }, s.framing);
  assert.deepEqual(Core.processPixels(im, s, a), expected); assert.deepEqual(worker(im, s, a), expected);
  const out = await exportPng(im, s, a); assert.deepEqual(out.data, Buffer.from(expected.data)); assert.equal(out.info.width, expected.width); assert.equal(out.info.height, expected.height); assert.equal(sha(im.data), before);
});
test('independent Levels: native worker PNG is independently decoded; neutral and active mixed-alpha pixels obey export sanitation', async () => {
  const im = picture(257, 17, true); for (const levels of [null, neutral(), recipe()]) { const s = settings({ levels }), expected = oracle(im, levels); for (let i = 0; i < expected.data.length; i += 4) if (!expected.data[i + 3]) expected.data[i] = expected.data[i + 1] = expected.data[i + 2] = 0; const out = await exportPng(im, s); assert.deepEqual(out.data, Buffer.from(expected.data)); assert.equal(out.info.width, im.width); assert.equal(out.info.height, im.height); }
});
test('independent Levels: project v7 roundtrip retains every recipe/history/source and review, with independent ownership', async () => {
  const im = picture(17, 13), bytes = await png(im), p = photo(im, bytes), saved = await P.encode({ version: 7, currentId: p.id, photos: [p] }), out = await P.decode(saved);
  assert.equal(P.inspectHeader(saved).version, P.VERSION); assert.deepEqual(out.photos[0].source.bytes, new Uint8Array(bytes)); assert.deepEqual(out.photos[0].review, p.review); assert.deepEqual(slots(out.photos[0]).map(s => s.levels), slots(p).map(s => s.levels)); out.photos[0].settings.levels.channels.rgb.gamma = 7; assert.equal(out.photos[0].committed.levels.channels.rgb.gamma, 1.31); assert.equal(p.settings.levels.channels.rgb.gamma, 1.31);
});
for (let version = 1; version <= 6; version++) test(`independent Levels: real rehashed project v${version} migrates all history to null Levels without source loss`, async () => {
  const im = picture(17, 13), bytes = await png(im), p = photo(im, bytes);
  for (const s of slots(p)) { s.advancedTone = Tone.defaults(); s.advancedTone.curves.blue = [0, .17, .57, .82, 1]; s.framing = { version: 1, crop: { x: .1, y: .1, w: .8, h: .8 }, quarterTurns: 1, flipX: true, flipY: false }; }
  const saved = await P.encode({ version: 7, currentId: p.id, photos: [p] });
  const legacy = rewriteProject(saved, d => { for (const p of d.photos) { if (version < 6) delete p.review; for (const s of slots(p)) { delete s.levels; if (version < 5) delete s.framing; if (version < 4) delete s.advancedTone; if (version < 3) { delete s.manualSelection; delete s.manualLiquify; delete s.manualRepair; } if (version < 2) delete s.localLayers; } } }, version);
  assert.equal(P.inspectHeader(legacy).version, version); const out = await P.decode(legacy); assert.equal(out.version, P.VERSION); for (const [i, s] of slots(out.photos[0]).entries()) { assert.equal(s.levels, null); assert.deepEqual(s.advancedTone, version >= 4 ? slots(p)[i].advancedTone : null); assert.deepEqual(s.framing, version >= 5 ? slots(p)[i].framing : null); } assert.deepEqual(out.photos[0].source.bytes, new Uint8Array(bytes)); if (version === 6) assert.deepEqual(out.photos[0].review, p.review);
});
test('independent Levels: validly rehashed v7 missing or malformed Levels reject in every current/history/export slot', async () => {
  const im = picture(17, 13), bytes = await png(im), p = photo(im, bytes), saved = await P.encode({ version: 7, currentId: p.id, photos: [p] });
  for (let slot = 0; slot < slots(p).length; slot++) for (const missing of [false, true]) { const bad = rewriteProject(saved, d => { const s = slots(d.photos[0])[slot]; if (missing) delete s.levels; else { s.levels = recipe(); s.levels.channels.blue.gamma = 0; } }); await assert.rejects(P.decode(bad), /levels/i); }
});
test('independent Levels: malformed project import/save is atomic and never overwrites existing files', async t => {
  const dir = await fixture(t), im = picture(17, 13), bytes = await png(im), p = photo(im, bytes), valid = await P.encode({ version: 7, currentId: p.id, photos: [p] }), bad = rewriteProject(valid, d => { d.photos[0].settings.levels.channels.rgb.inputWhite = 0; });
  const existing = path.join(dir, 'existing.mintproj'), incoming = path.join(dir, 'bad.mintproj'); await fsp.writeFile(existing, valid); await fsp.writeFile(incoming, bad); let saveDialogs = 0;
  const store = createProjectStore({ dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [incoming] }), showSaveDialog: async () => { saveDialogs++; return { canceled: false, filePath: existing }; } }, decode: P.decode, inspectHeader: P.inspectHeader, maxBytes: P.MAX_CONTAINER_BYTES });
  await assert.rejects(store.open(), /levels/i); await assert.rejects(store.save({ bytes: new Uint8Array(bad), suggestedName: 'bad' }), /levels/i); assert.equal(saveDialogs, 0); assert.deepEqual(await fsp.readFile(existing), Buffer.from(valid)); assert.deepEqual(await fsp.readFile(incoming), bad); assert.deepEqual((await fsp.readdir(dir)).sort(), ['bad.mintproj', 'existing.mintproj']); assert.equal(store.isBusy(), false);
});
test('independent Levels: preset codec requires both dependencies, v2 owns Levels, v1 migrates null and colorOnly retains Levels', () => {
  for (const options of [{ advancedTone: Tone }, { levels: L }, { advancedTone: Tone, levels: null }]) assert.throws(() => createCodec(options));
  const codec = createCodec({ advancedTone: Tone, levels: L }), doc = codec.defaults('Levels independent'); doc.controls.levels = recipe(); doc.controls.beauty.lip = 27;
  const parsed = codec.parse(codec.stringify(doc)); assert.equal(parsed.version, 3); assert.deepEqual(plain(parsed.controls.levels), recipe()); const color = codec.colorOnly(doc); assert.deepEqual(plain(color.controls.levels), recipe()); assert.equal(color.controls.beauty.lip, 0); color.controls.levels.channels.red.gamma = 7; assert.equal(doc.controls.levels.channels.red.gamma, .82);
  const old = plain(doc); old.version = 1; delete old.controls.levels; delete old.controls.lightBalance; const migrated = codec.parse(JSON.stringify(old)); assert.equal(migrated.version, 3); assert.equal(migrated.controls.levels, null); assert.equal(migrated.controls.beauty.lip, 27); assert.equal(JSON.parse(codec.stringify(old)).version, 3);
  const invalid = plain(doc); delete invalid.controls.levels; assert.throws(() => codec.parse(JSON.stringify(invalid)), /controls/i);
});
test('independent Levels: browser-realm preset codec and core match CommonJS without rendering hooks', () => {
  const codec = createCodec({ advancedTone: Tone, levels: L }), doc = codec.defaults('色阶🙂'); doc.controls.levels = recipe(); const source = codec.stringify(doc), c = vm.createContext({ source });
  for (const filename of ['levels.cjs', 'advanced-tone.cjs', 'preset-codec.cjs']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', filename), 'utf8'), c);
  assert.equal(vm.runInContext('MintAdjustmentPreset.createCodec({advancedTone:MintAdvancedTone,levels:MintLevels}).stringify(MintAdjustmentPreset.createCodec({advancedTone:MintAdvancedTone,levels:MintLevels}).parse(source))', c), source);
});
test('independent Levels: malformed/duplicate v2 preset imports never mutate existing catalog or backup', async t => {
  const dir = await fixture(t), root = path.join(dir, 'catalog'), incoming = path.join(dir, 'bad.mintpreset.json'), codec = createCodec({ advancedTone: Tone, levels: L });
  const doc = codec.defaults('Retain'); doc.controls.levels = recipe(); const store = createPresetStore({ root, codec, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [incoming] }) } }); await store.save({ document: doc }); await store.save({ document: codec.defaults('Second') });
  const file = path.join(root, 'catalog.mintpresets'), backup = path.join(root, 'catalog.previous.mintpresets'), before = [await fsp.readFile(file), await fsp.readFile(backup)]; const text = codec.stringify(doc);
  for (const bad of [text.replace('"gamma":1.31', '"gamma":0'), text.replace('"gamma":1.31', '"gamma":1.31,"gamm\\u0061":1'), text.replace('"levels":', '"levels":null,"lev\\u0065ls":')]) { await fsp.writeFile(incoming, bad); await assert.rejects(store.open()); assert.deepEqual(await fsp.readFile(file), before[0]); assert.deepEqual(await fsp.readFile(backup), before[1]); assert.equal(store.isBusy(), false); }
});
