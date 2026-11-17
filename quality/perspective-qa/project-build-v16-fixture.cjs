'use strict';
// Rebuild only on purpose with the immutable checkpoint26 architecture ZIP.
// Tests consume the committed binary, not the current writer or this script.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const Module = require('node:module'), crypto = require('node:crypto'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..'), archive = process.argv[2];
if (!archive) throw Error('Usage: node project-build-v16-fixture.cjs /path/to/checkpoint26/architecture.zip');
const sha = v => crypto.createHash('sha256').update(v).digest('hex');
const archived = name => cp.execFileSync('unzip', ['-p', archive, name]);
function oldModule(name) {
  const source = archived(name), filename = path.join(root, name), m = new Module(filename);
  m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename)); m._compile(source.toString(), filename);
  return { api: m.exports, sha256: sha(source) };
}
(async () => {
  const old = oldModule('src/project-document.cjs'), binding = oldModule('src/redaction-layers.cjs');
  assert.equal(old.api.VERSION, 16); assert.equal(Object.hasOwn(old.api.DEFAULT_SETTINGS, 'perspective'), false);
  const testSource = archived('tests/image-asset-project.test.cjs').toString();
  const captured = testSource.match(/const historical15 = \(\) => zlib\.gunzipSync\(Buffer\.from\('([^']+)'/);
  assert.ok(captured); const historical15 = zlib.gunzipSync(Buffer.from(captured[1], 'base64'));
  const input = await old.api.decode(historical15), photo = input.photos[0];
  const assetCodec = require(path.join(root, 'src/image-assets.cjs')).createCodec({ overlay: require(path.join(root, 'src/image-overlay.cjs')) });
  const raw = new Uint8Array([255, 0, 34, 0, 12, 184, 99, 127, 63, 9, 201, 255, 4, 7, 90, 64]);
  const asset = await assetCodec.createAsset({ width: 2, height: 2, data: raw }); photo.imageAssets = [asset];
  const slots = [photo.settings, photo.committed, ...photo.undo, ...photo.redo, photo.exportedSettings];
  const selection = { version: 1, sourceRevision: photo.sourceRevision, base: 'none', inverted: false, feather: 0, commands: [{ kind: 'brush', mode: 'add', radius: .2, points: [{ x: .25, y: .5 }] }] };
  for (const [i, s] of slots.entries()) {
    s.imageLayers = [{ id: 'image-' + i, name: 'Synthetic image ' + i, enabled: i % 2 === 0, assetId: asset.id, recipe: { ...require(path.join(root, 'src/image-overlay.cjs')).defaults(), rotation: i * 7, opacity: i / 6 } }];
    const geometryKey = binding.api.geometryKey(s);
    s.paintLayers = { version: 1, sourceRevision: photo.sourceRevision, geometryKey, layers: [{ id: 'paint-' + i, name: 'Historical paint ' + i, enabled: i % 2 === 0, selection: structuredClone(selection), recipe: { version: 1, strokes: [{ mode: 'paint', color: '#ef4010', width: .12, opacity: .7, points: [{ x: .1, y: .5 }, { x: .9, y: .5 }] }] } }] };
    s.redactions = { version: 1, sourceRevision: photo.sourceRevision, geometryKey, layers: [{ id: 'redact-' + i, name: 'Historical redaction ' + i, enabled: i % 2 !== 0, selection: structuredClone(selection), recipe: { version: 1, mode: 'cover', color: '#123456', blockSize: .1, strokes: [{ radius: .1, points: [{ x: .3, y: .7 }] }] } }] };
  }
  const bytes = await old.api.encode(input); assert.equal(old.api.inspectHeader(bytes).version, 16);
  const roundtrip = await old.api.decode(bytes); assert.deepEqual(roundtrip, input);
  const meta = JSON.parse(Buffer.from(bytes.subarray(64, 64 + old.api.inspectHeader(bytes).metadataBytes)).toString());
  for (const s of [meta.photos[0].settings, meta.photos[0].committed, ...meta.photos[0].undo, ...meta.photos[0].redo, meta.photos[0].exportedSettings]) assert.equal(Object.hasOwn(s, 'perspective'), false);
  fs.writeFileSync(path.join(__dirname, 'project-v16-historical.mintproj'), bytes);
  const manifest = { fixture: 'project-v16-historical.mintproj', fixtureSha256: sha(bytes), byteLength: bytes.length, writerVersion: old.api.VERSION, writerSha256: old.sha256, geometryWriterSha256: binding.sha256, seedV15Sha256: sha(historical15), sourceSha256: photo.source.sha256, rawAssetSha256: sha(raw), oldGeometryKey: slots[0].paintLayers.geometryKey, scope: 'Synthetic immutable PNG bytes, six independent history slots, learned signed-zero cache, one embedded 2x2 RGBA asset, historical selected paint and redaction collections. No image/model execution.' };
  fs.writeFileSync(path.join(__dirname, 'project-v16-historical-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ writerVersion: old.api.VERSION, fixtureSha256: manifest.fixtureSha256, byteLength: bytes.length }));
})().catch(e => { console.error(e); process.exitCode = 1; });
