'use strict';
// Rehashed historical frames must not inherit newly introduced v16 fields.
function historicalImageFields(doc) {
  if (doc.format === 'mint-portrait-project' && doc.version < 16) for (const photo of doc.photos) {
    delete photo.imageAssets;
    for (const state of [photo.settings, photo.committed, ...photo.undo, ...photo.redo, photo.exportedSettings].filter(Boolean)) delete state.imageLayers;
  }
  return doc;
}

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const sharp = require('sharp');
const P = require('../src/project-document.cjs');
const Padding = require('../src/canvas-padding.cjs');
const Review = require('../src/photo-review.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const settings = extra => ({...structuredClone(P.DEFAULT_SETTINGS), ...extra});
const recipe = extra => ({...Padding.defaults(), top:.2, right:.3, bottom:.1, left:.4, color:'#7ab3de', opacity:.6, ...extra});
const slots = photo => [photo.settings, photo.committed, ...photo.undo, ...photo.redo, photo.exportedSettings];
async function fixture() {
  const bytes = new Uint8Array(await sharp({create:{width:11,height:7,channels:4,background:'#4682b4'}}).png().toBuffer());
  const photo = {id:'padding-photo', name:'Original.png', sourceRevision:'padding-source:1', source:{bytes,mime:'image/png',width:11,height:7}, selected:true, settings:settings({canvasPadding:recipe()}), committed:settings({canvasPadding:recipe({left:.1})}), undo:[settings()], redo:[settings({canvasPadding:recipe({opacity:0})})], exportedSettings:settings({canvasPadding:recipe({color:'#ffffff'})}), revision:3, preset:null, imageAssets:[], learnedCache:[], review:Review.edit(Review.defaults(),{rating:4,flag:'pick'})};
  return {version:P.VERSION,currentId:photo.id,photos:[photo]};
}
function rewrite(bytes, change) {
  const frame = P.inspectHeader(bytes), doc = JSON.parse(Buffer.from(bytes.subarray(64,64+frame.metadataBytes)));
  change(doc);
  const json = Buffer.from(JSON.stringify(historicalImageFields(doc))), payload = Buffer.from(bytes.subarray(64+frame.metadataBytes)), header = Buffer.from(bytes.subarray(0,64));
  header.writeUInt32LE(doc.version,8); header.writeUInt32LE(json.length,16); header.writeUInt32LE(64+json.length+payload.length,24);
  Buffer.from(hash(json),'hex').copy(header,32);
  return Buffer.concat([header,json,payload]);
}
test('padding shared core is an exact frozen byte copy, not a desktop math fork', () => {
  assert.equal(hash(fs.readFileSync(require.resolve('../src/canvas-padding.cjs'))),'91412cfaefd331c6fc5fffb8f9f58256dd25eb6306de6511cdec1cd2a2deb995');
  assert.equal(Padding.version,'1.0.0'); assert.equal(P.DEFAULT_SETTINGS.canvasPadding,null);
});
test('v8 roundtrip preserves independent recipes, source bytes, review, and every edit-history slot', async () => {
  const input = await fixture(), before = structuredClone(input), encoded = await P.encode(input), restored = await P.decode(encoded), photo = restored.photos[0];
  assert.equal(P.inspectHeader(encoded).version,P.VERSION); assert.equal(restored.version,P.VERSION);
  assert.deepEqual(slots(photo),slots(before.photos[0])); assert.deepEqual(photo.source.bytes,before.photos[0].source.bytes); assert.deepEqual(photo.review,before.photos[0].review); assert.deepEqual(input,before);
  assert.deepEqual(await P.encode(restored),encoded);
  photo.settings.canvasPadding.top = .49;
  assert.equal(photo.committed.canvasPadding.top,.2); assert.equal(photo.redo[0].canvasPadding.top,.2); assert.equal(input.photos[0].settings.canvasPadding.top,.2);
});
for (const version of [1,2,3,4,5,6,7]) test(`v${version} missing padding migrates to explicit null in every recipe without rewriting originals`, async () => {
  const input = await fixture(), saved = await P.encode(input), legacy = rewrite(saved, doc => {
    doc.version=version;
    for (const photo of doc.photos) { if(version<6)delete photo.review; for(const s of slots(photo)) delete s.canvasPadding; }
  }), before = hash(legacy), out = await P.decode(legacy);
  assert.equal(out.version,P.VERSION); for(const s of slots(out.photos[0])) assert.equal(s.canvasPadding,null);
  assert.deepEqual(out.photos[0].source.bytes,input.photos[0].source.bytes); assert.equal(hash(legacy),before);
  if(version>=6) assert.deepEqual(out.photos[0].review,input.photos[0].review);
  assert.equal(P.inspectHeader(await P.encode(out)).version,P.VERSION);
});
for (let index=0;index<5;index++) test(`v8 slot ${index} requires explicit canvasPadding on write and correctly hashed import`, async () => {
  const input=await fixture(), saved=await P.encode(input);
  delete slots(input.photos[0])[index].canvasPadding;
  await assert.rejects(P.encode(input),/Missing settings field: canvasPadding/);
  const tampered=rewrite(saved,doc=>delete slots(doc.photos[0])[index].canvasPadding);
  await assert.rejects(P.decode(tampered),/Missing settings field: canvasPadding/);
});
test('strict padding rejects partial, unknown, coercible, unsafe, and out-of-range recipes without invoking accessors', () => {
  const invalid = [{}, {version:1}, {...recipe(),top:'0.1'}, {...recipe(),left:.50001}, {...recipe(),bottom:-.001}, {...recipe(),opacity:NaN}, {...recipe(),color:'#fff'}, {...recipe(),extra:true}, {...recipe(),version:2}, []];
  for(const canvasPadding of invalid) assert.throws(()=>P.validateSettings(settings({canvasPadding}),{width:11,height:7},'source:1'),/padding/i);
  let reads=0; const accessor=recipe(); Object.defineProperty(accessor,'top',{enumerable:true,get(){reads++;return .1;}});
  assert.throws(()=>P.validateSettings(settings({canvasPadding:accessor}),{width:11,height:7},'source:1'),/padding/i); assert.equal(reads,0);
  const s=settings({canvasPadding:recipe()}); Object.defineProperty(s,'canvasPadding',{enumerable:true,get(){reads++;return recipe();}});
  assert.throws(()=>P.validateSettings(s,{width:11,height:7},'source:1'),/Accessors/); assert.equal(reads,0);
});
test('malformed recipe in every imported history slot rejects even with valid container and blob hashes', async () => {
  const saved=await P.encode(await fixture());
  for(let i=0;i<5;i++) for(const patch of [{opacity:1.001},{left:'0.3'},{color:'#12345g'},{version:2},{unknown:1}]) {
    const bad=rewrite(saved,doc=>{slots(doc.photos[0])[i].canvasPadding={...recipe(),...patch};});
    await assert.rejects(P.decode(bad),/Invalid canvas padding/);
  }
  const legacy=rewrite(saved,doc=>{doc.version=7;doc.photos[0].settings.canvasPadding={version:1};});
  await assert.rejects(P.decode(legacy),/Invalid canvas padding/);
});
test('metadata validation does not confuse large retained originals with renderable padded canvas', () => {
  const value=P.validateSettings(settings({canvasPadding:recipe({top:.5,right:.5,bottom:.5,left:.5,color:'#ABCDEF',opacity:-0})}),{width:15000,height:15000},'source:large');
  assert.equal(value.canvasPadding.color,'#abcdef'); assert.equal(Object.is(value.canvasPadding.opacity,-0),false);
  assert.throws(()=>Padding.plan(15000,15000,value.canvasPadding),/budget|range/i);
});
test('v8 encoding snapshots recipe values before asynchronous hashing', async () => {
  const input=await fixture(), before=structuredClone(input); let first=true;
  const bytes=await P.encode(input,{sha256:async bytes=>{if(first){first=false;for(const s of slots(input.photos[0]))if(s.canvasPadding)s.canvasPadding.left=.49;}return hash(bytes);}});
  assert.deepEqual(slots((await P.decode(bytes)).photos[0]),slots(before.photos[0]));
});
test('browser UMD project codec validates and restores active padding without Node globals', async () => {
  const input=await fixture(); input.photos[0].source.bytes=Array.from(input.photos[0].source.bytes);
  const c=vm.createContext({crypto:crypto.webcrypto,TextEncoder,TextDecoder,Uint8Array,Uint16Array,Float32Array,ArrayBuffer,DataView,inputJSON:JSON.stringify(input)});
  for(const file of ['canvas-padding.cjs','photo-review.cjs','project-document.cjs'])vm.runInContext(fs.readFileSync(require.resolve('../src/'+file),'utf8'),c);
  vm.runInContext('const input=JSON.parse(inputJSON);input.photos[0].source.bytes=Uint8Array.from(input.photos[0].source.bytes);globalThis.output=MintProjectDocument.encode(input).then(bytes=>MintProjectDocument.decode(bytes));',c);
  const output=await c.output;
  assert.equal(output.version,P.VERSION); assert.deepEqual(JSON.parse(JSON.stringify(output.photos[0].settings.canvasPadding)),recipe());
});
