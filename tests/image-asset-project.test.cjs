'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const zlib = require('node:zlib');
const P = require('../src/project-document.cjs');
const Overlay = require('../src/image-overlay.cjs');
const Assets = require('../src/image-assets.cjs');
const codec = Assets.createCodec({ overlay: Overlay });
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
// Captured from the genuine checkpoint25 v15 writer before the v16 change.
const historical15 = () => zlib.gunzipSync(Buffer.from('H4sIAAAAAAACA+1YQWskRRRuF5R1ZRFcvQiy0l48zKzT09M90wFdN5tdnSUJIQkKSsDq7tczla2u6q2unmQMA4u3xZM/Ym+6XjyriKA3Dx48ePEnePQi+qpqeqYTIggiJJDATL9671W9r1599TKvN4abu1vb95znHcd5Gz+fX3Oce/gMX3ScS/j85oMnf+58+eDHnz97/9nfxAtv3fzh08fPfaGu/fXL3dff/Np7fORmQuZEuStuTrlqF0IqSSgKUuxDotyWOwFZUsHdFS9ouUklJXA1THFCMRZKtD10MVLprnx45NLjFk5yQMUwzytFYgavlqKSCdwo+AitdrANE2oj1BNXrKHdWfi4K0duPFWAQdyYidiYcmoWpzkZwRt2xQOaqjFCbbljoKOxMqKeuA58pC39Di45Jt0gxJndsNfpBFHYiTxvEIdRkHh+NOj0wn7o97uQkH6Q+J3U70AQdcJ+H7+7qedDr5cFfhAm7gwXA4Z5Aty2khXosVKUj0qNGA4LUVYSDIpEcExtiZA0BKIqSZTZNQ4V5AVIrQNrzoXQaFGMpd4HWL8DIvO5vmQ0NwJMdVZQ4KK0s/fJgZ062hCpzpDANSgnzNW6VVZJBDTQ8m3BBA7c1yACgMjY7wJRY0BtF4MUQulz3Wu5FU9B3pnaCBJSDqUNy2hho7GqtNAKwjAJOjA329RxmUgIWydTJJNdLye8ImzHZM+kgVeM1ep1+qCi2bTpuQ0FodJqmE7JKmGEa2bYiQwmwMp6RNKJNqa7gi888NhlYWEfNViNzrmouKWKJCmtSiOqsYRyLBierI/nnEmCN2S0WExfk/nBWE1C+ISUWyRNG24KDlVz17gHvlBYF8wlMSlYaDKSwK10vypVjnetXO6QSA7pBsHcmguYawmv2UyTK8+pMjRs0q57QbuzT7vu+aUdno4wZX9JOf+Ccmefcv65pVyTar0Lqp19qvXOK9X2zCony1twwbmzz7ngXHOu7ob6GAWRgzox7zZJxrBsturJLfc+5bWCmm7ItFMnerV/03PVNNuhH5vO65SuaqaRlhVT2m4g/IMj+gmqbYeGUlNL/1MXLAuiaaAntGsI7YIeajrg9eCJsCeCFMYONWOCKL+LlpQoUveF5mcJNq8T4JZUR4u04BXSBFakvH8sS8ZgsmS4jRE5Zrld+5vnezXLXO+GztCBgV3u1J0k+Y9/ehd4JMcAJ0XlzmazVt349mp6wMFJ4s/bcq3WxUgnCbOcMaKzxfXVQfaQGPczHy5/uy3L3B4qdaGT2EbsnNrFhhfF7+wXv/C8Fj9Nb32HGy+SFq965leiQQGRZaY0dv7f9ztNII0aOy8+DBpI+ieg9BpIwjQYhBHiCZIo9ZKMZJ4f9LwkTrvBIBuEXuRDFvpJN/NSf5CFcZyQKPT6CDPtx2mI/xpmj7Y237l65eUrjuNcHb67to3Pp/Tn8jP4ff2l7x8Zw9qt3cuvJH/89O3v152nH166Ofzu16/Q4AzvbK49Wf3oExQf/g28xLj2NhQAAA==', 'base64'));
const historicalSha = '1acd946c35905e70ecd6d7d333517b140986bd9075e832f11309dafc646a1b09';
const slots = p => [p.settings, p.committed, ...p.undo, ...p.redo, ...(p.exportedSettings ? [p.exportedSettings] : [])];
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
function directoryContainer(doc, source) {
  let offset = 0; for (let i = 0; i < doc.blobs.length; i++) { doc.blobs[i].id = `blob-${i}`; doc.blobs[i].offset = offset; offset += doc.blobs[i].byteLength; }
  // Reserve zero-filled storage without copying or constructing pixel arrays. Rejected
  // directory/budget cases must not reach asset reconstruction or raster execution.
  const json = Buffer.from(JSON.stringify(doc)), out = new Uint8Array(64 + json.length + offset), h = new DataView(out.buffer);
  out.set([77, 73, 78, 84, 80, 82, 74, 0]); h.setUint32(8, doc.version, true); h.setUint32(12, 64, true);
  h.setUint32(16, json.length, true); h.setUint32(20, offset, true); h.setUint32(24, out.length, true); h.setUint32(28, doc.blobs.length, true);
  out.set(Buffer.from(sha(json), 'hex'), 32); out.set(json, 64); if (source) out.set(source, 64 + json.length); return out;
}
const fixture = () => P.decode(historical15());
async function asset(seed = 1, width = 2, height = 2) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 47 + seed * 17) & 255;
  data[3] = 0; return codec.createAsset({ width, height, data });
}
function layer(a, n = 0) { return { id: 'image-' + n, name: '贴纸 🌿', enabled: true, assetId: a.id, recipe: { ...Overlay.defaults(), x: .125, y: .875, size: .625, rotation: -17.5, opacity: .75, flipX: true } }; }
async function withAsset() { const input = await fixture(), a = await asset(); input.photos[0].imageAssets = [a]; slots(input.photos[0]).forEach((s, i) => { s.imageLayers = [layer(a, i)]; }); return input; }
function plainPhoto(base, id) {
  const p = structuredClone(base); p.id = id; p.sourceRevision = id + ':source-0'; p.learnedCache = []; p.imageAssets = [];
  for (const s of slots(p)) { s.imageLayers = []; delete s.learnedMatteId; } return p;
}

test('genuine frozen v15 migrates every history slot and preserves immutable bytes and float signed zero', async () => {
  const original = historical15(), doc = metadata(original), restored = await fixture();
  assert.equal(sha(original), historicalSha); assert.equal(P.inspectHeader(original).version, 15); assert.equal(P.VERSION, 17); assert.equal(restored.version, 17);
  assert.deepEqual(P.DEFAULT_SETTINGS.imageLayers, []); assert.deepEqual(restored.photos[0].imageAssets, []);
  assert.deepEqual(slots(restored.photos[0]), slots(doc.photos[0]).map(s => ({ ...s, imageLayers: [], perspective: null })));
  assert.equal(Object.is(restored.photos[0].learnedCache[0].result.matte.data[0], -0), true);
  assert.deepEqual(payload(await P.encode(restored)), payload(original)); assert.equal(sha(original), historicalSha);
});
for (let version = 1; version <= 15; version++) test(`legacy schema${version} migrates image fields only without payload changes`, async () => {
  const old = rewrite(historical15(), d => { d.version = version; if (version < 6) delete d.photos[0].review; });
  const out = await P.decode(old); assert.deepEqual(out.photos[0].imageAssets, []);
  for (const s of slots(out.photos[0])) assert.deepEqual(s.imageLayers, []);
  assert.deepEqual(payload(await P.encode(out)), payload(old));
});
test('one raw asset blob serves many independent current, committed, undo, redo and export recipes', async () => {
  const input = await withAsset(), p = input.photos[0], a = p.imageAssets[0];
  p.undo = Array.from({ length: 40 }, (_, i) => ({ ...structuredClone(p.settings), imageLayers: [{ ...layer(a, i), enabled: i % 2 === 0 }] }));
  p.redo = Array.from({ length: 40 }, (_, i) => ({ ...structuredClone(p.settings), imageLayers: [{ ...layer(a, i), recipe: { ...Overlay.defaults(), opacity: 0 } }] }));
  const before = structuredClone(input), encoded = await P.encode(input), doc = metadata(encoded), out = await P.decode(encoded);
  assert.deepEqual(input, before); assert.deepEqual(out, before); assert.deepEqual(await P.encode(out), encoded);
  assert.equal(doc.blobs.filter(b => b.kind === 'rgba8').length, 1); assert.equal(doc.photos[0].imageAssets.length, 1);
  assert.deepEqual(Object.keys(doc.photos[0].imageAssets[0]), ['id', 'version', 'width', 'height', 'bytes', 'byteLength']);
  assert.equal(JSON.stringify(doc).includes(a.data), false); assert.equal(doc.photos[0].imageAssets[0].byteLength, 16);
  const b = doc.blobs.find(b => b.kind === 'rgba8'); assert.deepEqual(payload(encoded).slice(b.offset, b.offset + b.byteLength), new Uint8Array(codec.toRaw(a).data));
  out.photos[0].undo[0].imageLayers[0].name = 'changed'; assert.notEqual(out.photos[0].settings.imageLayers[0].name, 'changed');
  assert.deepEqual(out.photos[0].source.bytes, before.photos[0].source.bytes);
});
test('identical content may be separately owned per photo but references never cross ownership tables', async () => {
  const input = await withAsset(), p = input.photos[0], q = plainPhoto(p, 'photo-2'); q.settings.imageLayers = [layer(p.imageAssets[0])]; input.photos.push(q);
  await assert.rejects(P.encode(input), /Missing or foreign image asset/);
  q.imageAssets = [p.imageAssets[0]]; const saved = await P.encode(input), out = await P.decode(saved);
  assert.equal(metadata(saved).blobs.filter(b => b.kind === 'rgba8').length, 2); assert.deepEqual(out.photos[0].imageAssets, out.photos[1].imageAssets);
});
for (const [i, name] of ['current', 'committed', 'undo0', 'undo1', 'redo', 'exported'].entries()) {
  test(`v16 requires explicit image layers and resolves disabled/zero-opacity references in ${name}`, async () => {
    const input = await withAsset(), saved = await P.encode(input); delete slots(input.photos[0])[i].imageLayers;
    await assert.rejects(P.encode(input), /Missing settings field: imageLayers/);
    await assert.rejects(P.decode(rewrite(saved, d => delete slots(d.photos[0])[i].imageLayers)), /Missing settings field: imageLayers/);
    for (const inactive of ['disabled', 'transparent']) await assert.rejects(P.decode(rewrite(saved, d => {
      const l = slots(d.photos[0])[i].imageLayers[0]; l.assetId = 'rgba-' + '0'.repeat(64); if (inactive === 'disabled') l.enabled = false; else l.recipe.opacity = 0;
    })), /Missing or foreign image asset/);
  });
}
test('v16 requires asset table; old schemas do not smuggle active new fields', async () => {
  const input = await withAsset(), saved = await P.encode(input); delete input.photos[0].imageAssets;
  await assert.rejects(P.encode(input), /Missing photo image assets/); await assert.rejects(P.decode(rewrite(saved, d => delete d.photos[0].imageAssets)), /Missing photo image assets/);
  await assert.rejects(P.decode(rewrite(saved, d => { d.version = 15; })), /Unknown blob encoding/);
  const a = await fixture(); a.version = 15; a.photos[0].imageAssets = [await asset()]; await assert.rejects(P.encode(a), /require project version 16/);
});
test('asset dimensions are identity-bound even when pixel byte count, blob hashes and metadata hashes remain valid', async () => {
  const a = await asset(1, 1, 4), b = await codec.createAsset({ width: 2, height: 2, data: codec.toRaw(a).data }); assert.notEqual(a.id, b.id);
  const input = await withAsset(), saved = await P.encode(input);
  await assert.rejects(P.decode(rewrite(saved, d => { const a = d.photos[0].imageAssets[0]; a.width = 1; a.height = 4; })), /image asset identity/i);
  const invalid = structuredClone(input); invalid.photos[0].imageAssets[0].width = 1; invalid.photos[0].imageAssets[0].height = 4;
  await assert.rejects(P.encode(invalid), /Image asset identity SHA-256 mismatch/);
});
test('recomputed blob/container hashes cannot disguise different RGBA bytes or fabricated content IDs', async () => {
  const saved = await P.encode(await withAsset());
  await assert.rejects(P.decode(rewrite(saved, (d, raw) => { const b = d.blobs.find(b => b.kind === 'rgba8'); raw[b.offset] ^= 64; b.sha256 = sha(raw.subarray(b.offset, b.offset + b.byteLength)); })), /image asset identity/i);
  await assert.rejects(P.decode(rewrite(saved, d => { const fake = 'rgba-' + 'f'.repeat(64); d.photos[0].imageAssets[0].id = fake; for (const s of slots(d.photos[0])) s.imageLayers[0].assetId = fake; })), /image asset identity/i);
  const corrupt = saved.slice(); corrupt[corrupt.length - 5] ^= 32; await assert.rejects(P.decode(corrupt), /blob SHA-256 mismatch/);
});
test('duplicate asset IDs, wrong kinds, reused blobs, missing blobs and orphan blobs reject atomically', async () => {
  const input = await withAsset(), saved = await P.encode(input);
  input.photos[0].imageAssets.push(input.photos[0].imageAssets[0]); await assert.rejects(P.encode(input), /Duplicate image asset ID/);
  const mutations = [
    d => d.photos[0].imageAssets.push({ ...d.photos[0].imageAssets[0] }),
    d => { d.photos[0].imageAssets[0].bytes = d.photos[0].source.bytes; },
    d => { d.photos[0].imageAssets[0].bytes = 'blob-missing'; },
    d => { d.photos[0].imageAssets.push({ ...d.photos[0].imageAssets[0], id: 'rgba-' + 'f'.repeat(64) }); },
    d => { d.photos[0].imageAssets = []; for (const s of slots(d.photos[0])) s.imageLayers = []; },
    d => { d.blobs.find(b => b.kind === 'rgba8').kind = 'float32le'; },
    d => { d.photos[0].imageAssets[0].byteLength += 4; }
  ];
  for (const mutate of mutations) await assert.rejects(P.decode(rewrite(saved, mutate)), /Duplicate image asset|blob|Unreferenced|descriptor byte length/);
  assert.deepEqual((await P.decode(saved)).photos[0].imageAssets, (await withAsset()).photos[0].imageAssets);
});
test('strict asset, layer and table own-data validation never evaluates accessors', async () => {
  let calls = 0;
  const changes = [
    p => { Object.defineProperty(p, 'imageAssets', { enumerable: true, get() { calls++; return []; } }); },
    p => { Object.defineProperty(p.imageAssets, '0', { enumerable: true, get() { calls++; return null; } }); },
    p => { Object.defineProperty(p.imageAssets[0], 'data', { enumerable: true, get() { calls++; return ''; } }); },
    p => { Object.defineProperty(p.settings.imageLayers[0].recipe, 'opacity', { enumerable: true, get() { calls++; return 0; } }); },
    p => { p.imageAssets[0].path = '/private/secret.png'; },
    p => { p.imageAssets[0].uri = 'file:///private/secret.png'; },
    p => { p.imageAssets[0].name = 'not asset metadata'; },
    p => { p.imageAssets[0][Symbol('x')] = 1; },
    p => { Object.defineProperty(p.imageAssets[0], 'width', { enumerable: false, value: 2 }); },
    p => { p.imageAssets[0] = Object.assign(Object.create({ hidden: true }), p.imageAssets[0]); },
    p => { p.imageAssets = new Array(1); },
    p => { p.imageAssets.extra = 1; },
    p => { Object.defineProperty(p.imageAssets, '0', { enumerable: false, value: p.imageAssets[0] }); },
    p => { p.imageAssets[0].data = 'AAAA'; },
    p => { p.imageAssets[0].id = 'RGBA-' + 'A'.repeat(64); },
    p => { p.imageAssets[0].version = 2; },
    p => { p.settings.imageLayers[0].recipe.version = 2; },
    p => { p.settings.imageLayers[0].recipe.opacity = NaN; }
  ];
  for (const change of changes) { const input = structuredClone(await withAsset()); change(input.photos[0]); await assert.rejects(P.encode(input), e => e.name === 'ProjectFormatError'); }
  assert.equal(calls, 0);
});
test('encode captures every asset, source, float plane and recipe before an injected asynchronous digest', async () => {
  const input = structuredClone(await withAsset()), before = structuredClone(input); let first = true;
  const pending = P.encode(input, { sha256: async bytes => {
    if (first) { first = false; const p = input.photos[0]; p.source.bytes.fill(0); p.learnedCache[0].result.matte.data.fill(1); p.imageAssets[0].id = 'rgba-' + 'f'.repeat(64); p.imageAssets[0].data = 'AAAA'; p.imageAssets.length = 0; p.settings.imageLayers[0].assetId = 'rgba-' + 'e'.repeat(64); }
    await Promise.resolve(); return sha(bytes);
  } });
  assert.deepEqual(await P.decode(await pending), before);
});
test('decode captures metadata and all payloads before its first await, without retaining file aliases', async () => {
  const input = await withAsset(), saved = await P.encode(input), pristine = saved.slice(); let first = true;
  const out = await P.decode(saved, { sha256: async bytes => { if (first) { first = false; saved.fill(0); } await Promise.resolve(); return sha(bytes); } });
  assert.deepEqual(out, input); assert.deepEqual(await P.decode(pristine), input);
  out.photos[0].source.bytes.fill(0); out.photos[0].learnedCache[0].result.matte.data.fill(1); out.photos[0].imageAssets.length = 0;
  assert.deepEqual(await P.decode(pristine), input);
});
test('photo and whole-project count caps reject before unbounded retained tables', async () => {
  const input = await withAsset(), p = input.photos[0]; p.imageAssets = Array.from({ length: 17 }, () => p.imageAssets[0]); await assert.rejects(P.encode(input), /excessive image assets/);
  const base = await withAsset(), assets = await Promise.all(Array.from({ length: 16 }, (_, i) => asset(i)));
  base.photos = Array.from({ length: 9 }, (_, i) => { const p = plainPhoto(base.photos[0], 'photo-' + i); p.imageAssets = assets.slice(0, i === 8 ? 1 : 16); return p; }); base.currentId = 'photo-0';
  await assert.rejects(P.encode(base), /Project image asset count limit exceeded/);
  base.photos.pop(); assert.equal((await P.decode(await P.encode(base))).photos.reduce((n, p) => n + p.imageAssets.length, 0), 128);
});
test('decoded metadata budgets precede base64 reconstruction and retain original cache/container ceilings', async () => {
  assert.equal(P.LIMITS.maxCacheBytes, 256 * 1024 * 1024); assert.equal(P.MAX_CONTAINER_BYTES, 672 * 1024 * 1024 + 64);
  const saved = await P.encode(await withAsset()), original = metadata(saved);
  const record = i => ({ id: 'rgba-' + i.toString(16).padStart(64, '0'), version: 1, width: 1024, height: 1024, bytes: 'blob-' + i, byteLength: 4 * 1024 * 1024 });
  const blob = (kind, byteLength) => ({ id: '', kind, offset: 0, byteLength, sha256: '0'.repeat(64) });
  const photoLimit = structuredClone(original); photoLimit.photos[0].imageAssets = Array.from({ length: 9 }, (_, i) => record(i + 1));
  photoLimit.blobs = [original.blobs[0], ...Array.from({ length: 9 }, () => blob('rgba8', 4 * 1024 * 1024))];
  await assert.rejects(P.decode(directoryContainer(photoLimit, (await fixture()).photos[0].source.bytes)), /Photo image asset byte limit/);
  const globalLimit = structuredClone(original); globalLimit.blobs = Array.from({ length: 17 }, () => blob('rgba8', 4 * 1024 * 1024));
  await assert.rejects(P.decode(directoryContainer(globalLimit)), /Project image asset byte limit exceeded/);
  const combined = structuredClone(original); combined.blobs = [...Array.from({ length: 4 }, () => blob('float32le', 64000000)), ...Array.from({ length: 4 }, () => blob('rgba8', 4 * 1024 * 1024))];
  await assert.rejects(P.decode(directoryContainer(combined)), /Combined learned cache and image asset byte limit exceeded/);
  const count = structuredClone(original); count.blobs = Array.from({ length: 129 }, () => blob('rgba8', 4));
  await assert.rejects(P.decode(directoryContainer(count)), /Project image asset count limit exceeded/);
});
test('unknown versions, encodings, metadata extensions and oversized asset descriptors fail closed', async () => {
  const saved = await P.encode(await withAsset());
  for (const mutate of [d => { d.version = 18; }, d => { d.photos[0].imageAssets[0].version = 2; }, d => { d.blobs.find(b => b.kind === 'rgba8').kind = 'png'; }, d => { d.photos[0].imageAssets[0].data = 'AAAA'; }, d => { d.photos[0].imageAssets[0].width = 1025; }, d => { d.photos[0].imageAssets[0].height = 0; }]) await assert.rejects(P.decode(rewrite(saved, mutate)), e => e.name === 'ProjectFormatError');
});
test('browser UMD roundtrip uses shared codec and WebCrypto, without renderer or file access', async () => {
  const saved = await P.encode(await withAsset()), c = vm.createContext({ TextEncoder, TextDecoder, crypto: crypto.webcrypto, Uint8Array, Uint8ClampedArray, Uint16Array, Float32Array, ArrayBuffer, DataView, inputJSON: JSON.stringify(Array.from(saved)) });
  for (const file of ['image-overlay.cjs', 'image-assets.cjs', 'image-layers.cjs', 'sharpness.cjs', 'photo-review.cjs', 'project-document.cjs']) vm.runInContext(fs.readFileSync(require.resolve('../src/' + file), 'utf8'), c);
  vm.runInContext(`MintImageOverlay = { ...MintImageOverlay, apply() { throw Error('No raster execution'); }, createProfile() { throw Error('No raster planning'); } }; globalThis.roundtrip = MintProjectDocument.decode(Uint8Array.from(JSON.parse(inputJSON))).then(s => MintProjectDocument.encode(s));`, c);
  assert.deepEqual(Buffer.from(await c.roundtrip), Buffer.from(saved));
});

test('metadata corruption keeps integrity-error precedence and source geometry remains independent of rendering caps', async () => {
  const input = await withAsset(), photo = input.photos[0];
  photo.source = { bytes: Uint8Array.from([255,216,255,192,0,11,8,15,160,195,80,1,1,17,0,255,218,0,2,255,217]), mime: 'image/jpeg', width: 50000, height: 4000 };
  photo.learnedCache = []; for (const s of slots(photo)) delete s.learnedMatteId;
  const saved = await P.encode(input), out = await P.decode(saved);
  assert.deepEqual(out.photos[0].imageAssets, photo.imageAssets); assert.deepEqual(slots(out.photos[0]), slots(photo));
  assert.deepEqual(out.photos[0].source.bytes, photo.source.bytes); assert.equal(out.photos[0].source.width, 50000);
  const malformed = saved.slice(); malformed[64] = 0; await assert.rejects(P.decode(malformed), /metadata SHA-256 mismatch/);
});
