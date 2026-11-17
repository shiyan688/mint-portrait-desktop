'use strict';
// Independent persistence and hostile-input audit. No private images or inference.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), vm = require('node:vm');
const P = require('../src/project-document.cjs'), Perspective = require('../src/perspective.cjs');
const Paint = require('../src/paint-layers.cjs'), Redact = require('../src/redaction-layers.cjs');
const fixturePath = path.join(__dirname, '../quality/perspective-qa/project-v16-historical.mintproj');
const manifest = require('../quality/perspective-qa/project-v16-historical-manifest.json');
const sha = v => crypto.createHash('sha256').update(v).digest('hex');
const historical = () => new Uint8Array(fs.readFileSync(fixturePath));
const slots = p => [p.settings, p.committed, ...p.undo, ...p.redo, ...(p.exportedSettings ? [p.exportedSettings] : [])];
const names = ['current', 'committed', 'undo[0]', 'undo[1]', 'redo[0]', 'exported'];
const metadata = b => JSON.parse(Buffer.from(b.subarray(64, 64 + P.inspectHeader(b).metadataBytes)).toString());
const payload = b => new Uint8Array(b.subarray(64 + P.inspectHeader(b).metadataBytes));
function pack(doc, raw) {
  const json = Buffer.from(JSON.stringify(doc)), out = new Uint8Array(64 + json.length + raw.length), h = new DataView(out.buffer);
  out.set([77, 73, 78, 84, 80, 82, 74, 0]);
  h.setUint32(8, doc.version, true); h.setUint32(12, 64, true); h.setUint32(16, json.length, true);
  h.setUint32(20, raw.length, true); h.setUint32(24, out.length, true); h.setUint32(28, doc.blobs.length, true);
  out.set(Buffer.from(sha(json), 'hex'), 32); out.set(json, 64); out.set(raw, 64 + json.length); return out;
}
function rewrite(bytes, change) { const doc = metadata(bytes), raw = payload(bytes); change(doc, raw); return pack(doc, raw); }
function active(n = 0) { return { version: 1, quad: [{ x: .1 + n / 1000, y: .05 }, { x: .93, y: .12 }, { x: .88, y: .94 }, { x: .04, y: .87 }], outputFraction: { width: .75, height: .8 } }; }
const fixture = async () => structuredClone(await P.decode(historical()));
function bindUnselected(s, perspective) {
  s.perspective = perspective;
  for (const key of ['paintLayers', 'redactions']) if (s[key]) {
    s[key].geometryKey = Redact.geometryKey(s);
    for (const layer of s[key].layers) layer.selection = null;
  }
}
async function activeFixture() {
  const input = await fixture(); slots(input.photos[0]).forEach((s, i) => bindUnselected(s, active(i))); return input;
}
// Properly remove post-version metadata and its unreferenced raw image blob,
// rather than pretending a v17 writer's bytes were produced historically.
function downgraded(version) {
  const doc = metadata(historical()), raw = payload(historical()); doc.version = version;
  const introduced = { localLayers: 2, manualSelection: 3, manualLiquify: 3, manualRepair: 3,
    advancedTone: 4, framing: 5, levels: 7, canvasPadding: 8, textLayers: 9, lightBalance: 10,
    redactions: 11, paintLayers: 12, faceAdjustments: 13, straighten: 14, sharpness: 15, imageLayers: 16 };
  for (const photo of doc.photos) {
    if (version < 6) delete photo.review;
    if (version < 16) delete photo.imageAssets;
    for (const s of slots(photo)) for (const [key, first] of Object.entries(introduced)) if (version < first) delete s[key];
  }
  if (version >= 16) return pack(doc, raw);
  let offset = 0; const parts = [], remap = new Map();
  doc.blobs = doc.blobs.filter(b => b.kind !== 'rgba8').map((b, i) => {
    const data = raw.slice(b.offset, b.offset + b.byteLength), id = 'blob-' + i; remap.set(b.id, id);
    const result = { ...b, id, offset }; offset += data.length; parts.push(data); return result;
  });
  for (const photo of doc.photos) {
    photo.source.bytes = remap.get(photo.source.bytes);
    for (const cache of photo.learnedCache) if (cache.kind === 'matting') cache.result.matte.data = remap.get(cache.result.matte.data);
  }
  return pack(doc, Buffer.concat(parts));
}
function assertValidFrame(bytes) {
  const h = P.inspectHeader(bytes), json = bytes.subarray(64, 64 + h.metadataBytes), doc = metadata(bytes), raw = payload(bytes);
  assert.equal(Buffer.from(bytes.subarray(32, 64)).toString('hex'), sha(json));
  for (const b of doc.blobs) assert.equal(sha(raw.subarray(b.offset, b.offset + b.byteLength)), b.sha256);
}

test('v17 default is explicit null; direct legacy omission is neutral and exact neutral remains a complete recipe', () => {
  assert.equal(P.VERSION, 17); assert.equal(P.DEFAULT_SETTINGS.perspective, null);
  const s = structuredClone(P.DEFAULT_SETTINGS); delete s.perspective;
  assert.equal(P.validateSettings(s, { width: 3, height: 2 }, 's:0').perspective, null);
  const neutral = structuredClone(Perspective.defaults()); neutral.quad[0].x = -0;
  const out = P.validateSettings({ ...s, perspective: neutral }, { width: 3, height: 2 }, 's:0');
  assert.deepEqual(out.perspective, Perspective.defaults()); assert.equal(Object.is(out.perspective.quad[0].x, -0), false);
});

test('genuine immutable v16 writer fixture migrates every slot while retaining source/cache/assets and old geometry keys', async () => {
  const original = historical(), doc = metadata(original), out = await fixture(), p = out.photos[0];
  assert.equal(manifest.writerVersion, 16); assert.equal(P.inspectHeader(original).version, 16);
  assert.equal(sha(original), 'b14b4bf87e6528a702a4096237770fa9270dc3b45511a31559a622671a2130f5');
  assert.equal(sha(original), manifest.fixtureSha256); assertValidFrame(original);
  for (const s of slots(doc.photos[0])) assert.equal(Object.hasOwn(s, 'perspective'), false);
  assert.deepEqual(slots(p), slots(doc.photos[0]).map(s => ({ ...s, perspective: null })));
  assert.deepEqual(slots(p).map(s => s.exposure), [1, 2, 3, 4, 5, 6]);
  assert.ok(slots(p).every(s => s.paintLayers.geometryKey === manifest.oldGeometryKey && s.redactions.geometryKey === manifest.oldGeometryKey));
  assert.equal(Object.is(p.learnedCache[0].result.matte.data[0], -0), true);
  assert.equal(sha(p.source.bytes), manifest.sourceSha256); assert.equal(p.imageAssets.length, 1);
  assert.equal(sha(Buffer.from(p.imageAssets[0].data, 'base64')), manifest.rawAssetSha256);
  assert.deepEqual(p.learnedCache[0].result.provenance, doc.photos[0].learnedCache[0].result.provenance);
  assert.deepEqual(p.review, doc.photos[0].review); assert.equal(p.revision, 7);
  const saved = await P.encode(out); assert.deepEqual(payload(saved), payload(original));
  assert.deepEqual(await P.decode(saved), out); assert.deepEqual(await P.encode(await P.decode(saved)), saved);
  assert.equal(sha(original), manifest.fixtureSha256);
});

for (let version = 1; version <= 16; version++) test(`properly framed schema${version} omission migrates perspective in all six settings slots`, async () => {
  const old = downgraded(version), originalHash = sha(old); assertValidFrame(old);
  assert.equal(P.inspectHeader(old).version, version);
  const out = await P.decode(old); assert.equal(out.version, 17);
  assert.deepEqual(slots(out.photos[0]).map(s => s.perspective), [null, null, null, null, null, null]);
  assert.deepEqual(slots(out.photos[0]).map(s => s.exposure), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(payload(await P.encode(out)), payload(old));
  assert.equal(Object.is(out.photos[0].learnedCache[0].result.matte.data[0], -0), true);
  assert.equal(sha(out.photos[0].source.bytes), manifest.sourceSha256); assert.equal(sha(old), originalHash);
});

for (const [index, name] of names.entries()) test(`v17 requires own explicit perspective in ${name} on both encode and rehashed decode`, async () => {
  const input = await fixture(), saved = await P.encode(input); delete slots(input.photos[0])[index].perspective;
  await assert.rejects(P.encode(input), /Missing settings field: perspective/);
  const bad = rewrite(saved, d => delete slots(d.photos[0])[index].perspective); assertValidFrame(bad);
  await assert.rejects(P.decode(bad), /Missing settings field: perspective/);
});

for (let version = 1; version <= 16; version++) test(`schema${version} cannot smuggle active perspective through any slot despite correct container and blob hashes`, async () => {
  const old = downgraded(version);
  for (const [index, name] of names.entries()) {
    const bad = rewrite(old, d => { const s = slots(d.photos[0])[index]; s.perspective = active(); s.paintLayers = null; s.redactions = null; });
    assertValidFrame(bad);
    await assert.rejects(P.decode(bad), /Active perspective requires project version 17/, name);
    const input = await P.decode(old); input.version = version;
    for (const p of input.photos) { if (version < 6) delete p.review; if (version < 16) { p.imageAssets = []; slots(p).forEach(s => { s.imageLayers = []; }); } }
    bindUnselected(slots(input.photos[0])[index], active());
    await assert.rejects(P.encode(input), /Active perspective requires project version 17/, name);
  }
});

test('active v17 recipes roundtrip independently in every slot without rewriting source, float cache or embedded asset blobs', async () => {
  const input = await activeFixture(), before = structuredClone(input), saved = await P.encode(input), out = await P.decode(saved);
  assert.deepEqual(out, before); assert.deepEqual(input, before); assert.deepEqual(payload(saved), payload(historical()));
  assert.deepEqual(await P.encode(out), saved);
  out.photos[0].settings.perspective.quad[0].x = .2;
  assert.equal(out.photos[0].committed.perspective.quad[0].x, .101);
  assert.equal(input.photos[0].settings.perspective.quad[0].x, .1);
  out.photos[0].source.bytes.fill(0); out.photos[0].learnedCache[0].result.matte.data[0] = 1; out.photos[0].imageAssets[0] = { ...out.photos[0].imageAssets[0], data: '' };
  assert.deepEqual(await P.decode(saved), before);
});

test('neutral v17 perspective never rekeys selected historical paint/redaction collections', async () => {
  const input = await fixture(), before = structuredClone(input);
  for (const s of slots(input.photos[0])) s.perspective = structuredClone(Perspective.defaults());
  const out = await P.decode(await P.encode(input));
  for (const [i, s] of slots(out.photos[0]).entries()) {
    assert.deepEqual(s.paintLayers, slots(before.photos[0])[i].paintLayers); assert.deepEqual(s.redactions, slots(before.photos[0])[i].redactions);
    assert.deepEqual(s.perspective, Perspective.defaults());
  }
});

for (const [index, name] of names.entries()) test(`bound collections refuse changed quad, output fraction, or reset in ${name} without rewriting strokes`, async () => {
  const input = await activeFixture(), saved = await P.encode(input), before = structuredClone(input);
  for (const key of ['paintLayers', 'redactions']) for (const edit of [s => { s.perspective.quad[0].x += .01; }, s => { s.perspective.outputFraction.width = .7; }, s => { s.perspective = null; }, s => { s.perspective = structuredClone(Perspective.defaults()); }]) {
    const other = key === 'paintLayers' ? 'redactions' : 'paintLayers';
    const bad = structuredClone(input), s = slots(bad.photos[0])[index]; s[other] = null; edit(s);
    await assert.rejects(P.encode(bad), /geometry changed/);
    await assert.rejects(P.decode(rewrite(saved, d => { const slot = slots(d.photos[0])[index]; slot[other] = null; edit(slot); })), /geometry changed/);
  }
  assert.deepEqual(input, before); assert.deepEqual(await P.decode(saved), before);
});

for (const [index, name] of names.entries()) test(`active perspective refuses captured paint/redaction selections even hidden or empty in ${name}`, async () => {
  const original = await fixture(), selected = structuredClone(slots(original.photos[0])[index]);
  for (const key of ['paintLayers', 'redactions']) for (const state of ['visible', 'hidden', 'empty']) {
    const input = await activeFixture(), s = slots(input.photos[0])[index];
    s[key].layers[0].selection = selected[key].layers[0].selection;
    if (state === 'hidden') s[key].layers[0].enabled = false;
    if (state === 'empty') s[key].layers[0].recipe.strokes = [];
    await assert.rejects(P.encode(input), /cannot follow perspective/);
    const good = await P.encode(await activeFixture());
    await assert.rejects(P.decode(rewrite(good, d => { slots(d.photos[0])[index][key] = s[key]; })), /cannot follow perspective/);
  }
});

test('malformed recipes reject own-data violations, unknown fields, unsafe geometry and nonfinite values without getters', async () => {
  let calls = 0;
  const mutate = [
    () => undefined, () => false, () => 1, () => [], () => ({}),
    r => { delete r.version; return r; }, r => ({ ...r, version: 2 }), r => ({ ...r, extra: 1 }),
    r => { r.quad[0].x = NaN; return r; }, r => { r.quad[0].x = Infinity; return r; },
    r => { r.quad[0].x = -.1; return r; }, r => { r.quad[0].x = '0.1'; return r; },
    r => { r.quad[1] = { ...r.quad[0] }; return r; }, r => { r.quad.reverse(); return r; },
    r => { r.quad[2] = { x: .2, y: .2 }; return r; },
    r => { r.quad.length = 3; return r; }, r => { delete r.quad[1]; return r; },
    r => { r.quad.extra = 1; return r; }, r => { r.quad[0].z = 0; return r; },
    r => { r.outputFraction.width = 0; return r; }, r => { r.outputFraction.height = 1.01; return r; },
    r => { delete r.outputFraction.height; return r; }, r => { r.outputFraction.units = 'px'; return r; },
    r => Object.assign(Object.create({ inherited: true }), r), r => ({ ...r, [Symbol('x')]: 1 }),
    r => { Object.defineProperty(r, 'quad', { enumerable: true, get() { calls++; return []; } }); return r; },
    r => { Object.defineProperty(r.quad, '0', { enumerable: true, get() { calls++; return { x: 0, y: 0 }; } }); return r; },
    r => { Object.defineProperty(r.quad[0], 'x', { enumerable: true, get() { calls++; return .1; } }); return r; },
    r => { Object.defineProperty(r.outputFraction, 'width', { enumerable: true, get() { calls++; return 1; } }); return r; },
    r => { Object.defineProperty(r, 'version', { enumerable: false, value: 1 }); return r; }
  ];
  for (const change of mutate) {
    const input = await activeFixture(); input.photos[0].settings.perspective = change(active());
    assert.throws(() => P.validateSettings(input.photos[0].settings, { width: 1, height: 1 }, input.photos[0].sourceRevision), e => e.name === 'ProjectFormatError');
    await assert.rejects(P.encode(input), e => e.name === 'ProjectFormatError');
  }
  for (const field of ['perspective', 'quad', 'outputFraction']) {
    const input = await activeFixture(), target = field === 'perspective' ? input.photos[0].settings : input.photos[0].settings.perspective;
    Object.defineProperty(target, field, { enumerable: true, get() { calls++; throw Error('getter must not run'); } });
    await assert.rejects(P.encode(input), e => e.name === 'ProjectFormatError');
  }
  assert.equal(calls, 0);
  const saved = await P.encode(await activeFixture());
  for (const value of [{}, [], { ...active(), version: 99 }, { ...active(), unknown: 'file:///private/not-read' }, { ...active(), outputFraction: { width: 0, height: 1 } }])
    await assert.rejects(P.decode(rewrite(saved, d => { d.photos[0].settings.perspective = value; })), /perspective/i);
});

test('encode captures perspective, source, asset and cache before asynchronous hashing; decode does not retain container aliases', async () => {
  const input = await activeFixture(), before = structuredClone(input); let first = true;
  const saved = await P.encode(input, { sha256: async b => {
    if (first) { first = false; input.photos[0].settings.perspective.quad[0].x = .2; input.photos[0].settings.perspective.outputFraction.width = .3; input.photos[0].source.bytes.fill(0); input.photos[0].learnedCache[0].result.matte.data.fill(1); input.photos[0].imageAssets[0].data = ''; }
    await Promise.resolve(); return sha(b);
  } });
  assert.deepEqual(await P.decode(saved), before); const pristine = saved.slice(); first = true;
  const out = await P.decode(saved, { sha256: async b => { if (first) { first = false; saved.fill(0); } await Promise.resolve(); return sha(b); } });
  assert.deepEqual(out, before); assert.deepEqual(await P.decode(pristine), before);
});

test('metadata-only validation accepts valid recipes for source dimensions beyond raster caps and never calls raster APIs', async () => {
  const s = { ...structuredClone(P.DEFAULT_SETTINGS), perspective: active() };
  assert.deepEqual(P.validateSettings(s, { width: 20000, height: 2 }, 'large:0').perspective, active());
  const input = await activeFixture(); for (const state of slots(input.photos[0])) { state.paintLayers = null; state.redactions = null; }
  const saved = await P.encode(input);
  const c = vm.createContext({ TextEncoder, TextDecoder, crypto: crypto.webcrypto, Uint8Array, Uint8ClampedArray, Uint16Array, Float32Array, ArrayBuffer, DataView, inputJSON: JSON.stringify(Array.from(saved)) });
  for (const file of ['image-overlay', 'image-assets', 'image-layers', 'sharpness', 'photo-review', 'perspective', 'project-document']) vm.runInContext(fs.readFileSync(require.resolve('../src/' + file + '.cjs'), 'utf8'), c);
  vm.runInContext(`MintPerspective = { ...MintPerspective, plan() { throw Error('No raster planning'); }, apply() { throw Error('No raster execution'); } }; MintImageOverlay = { ...MintImageOverlay, apply() { throw Error('No image execution'); } }; globalThis.result = MintProjectDocument.decode(Uint8Array.from(JSON.parse(inputJSON))).then(x => MintProjectDocument.encode(x));`, c);
  assert.deepEqual(Buffer.from(await c.result), Buffer.from(saved));
});

test('corrupt metadata keeps integrity-error precedence and future versions fail closed', async () => {
  const saved = await P.encode(await activeFixture()), bad = saved.slice(); bad[80] ^= 1;
  await assert.rejects(P.decode(bad), /metadata SHA-256 mismatch/);
  await assert.rejects(P.decode(rewrite(saved, d => { d.version = 18; })), /Unsupported project version/);
  assert.equal(sha(fs.readFileSync(require.resolve('../src/perspective.cjs'))), '3a3b57ea8da4ce4a7c99b180a454e9f00a4242a0460621d267ad5487fbe66557');
});
