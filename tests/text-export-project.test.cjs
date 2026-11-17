'use strict';
// Rehashed historical frames must not inherit newly introduced v16 fields.
function historicalImageFields(doc) {
  if (doc.format === 'mint-portrait-project' && doc.version < 16) for (const photo of doc.photos) {
    delete photo.imageAssets;
    for (const state of [photo.settings, photo.committed, ...photo.undo, ...photo.redo, photo.exportedSettings].filter(Boolean)) delete state.imageLayers;
  }
  return doc;
}

const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm'),sharp=require('sharp');
const P=require('../src/project-document.cjs'),Text=require('../src/text-overlay.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const settings=text=>({...structuredClone(P.DEFAULT_SETTINGS),textLayers:text===undefined?[]:[{id:'text:1',enabled:true,recipe:{...Text.defaults(),text}}]});
const slots=p=>[p.settings,p.committed,...p.undo,...p.redo,p.exportedSettings];
async function fixture(){const bytes=new Uint8Array(await sharp({create:{width:11,height:7,channels:4,background:'#94ab76'}}).png().toBuffer());return{version:P.VERSION,currentId:'p1',photos:[{id:'p1',name:'original.png',sourceRevision:'source:1',source:{bytes,mime:'image/png',width:11,height:7},selected:true,settings:settings('Current 薄荷'),committed:settings('Committed'),undo:[settings()],redo:[settings('Redo')],exportedSettings:settings('Exported'),revision:4,preset:null,imageAssets:[],learnedCache:[],review:{version:1,current:{rating:4,flag:'pick',label:'green'},undo:[],redo:[]}}]};}
function rewrite(bytes,change){const frame=P.inspectHeader(bytes),doc=JSON.parse(Buffer.from(bytes.subarray(64,64+frame.metadataBytes)));change(doc);const json=Buffer.from(JSON.stringify(historicalImageFields(doc))),payload=Buffer.from(bytes.subarray(64+frame.metadataBytes)),header=Buffer.from(bytes.subarray(0,64));header.writeUInt32LE(doc.version,8);header.writeUInt32LE(json.length,16);header.writeUInt32LE(64+json.length+payload.length,24);Buffer.from(sha(json),'hex').copy(header,32);return Buffer.concat([header,json,payload]);}
test('schema9 roundtrip preserves independent editable recipes in every slot and original compressed bytes',async()=>{
 const input=await fixture(),before=structuredClone(input),encoded=await P.encode(input),out=await P.decode(encoded);assert.equal(P.inspectHeader(encoded).version,P.VERSION);assert.equal(out.version,P.VERSION);assert.deepEqual(slots(out.photos[0]),slots(before.photos[0]));assert.deepEqual(out.photos[0].source.bytes,before.photos[0].source.bytes);assert.deepEqual(input,before);assert.deepEqual(await P.encode(out),encoded);
 out.photos[0].settings.textLayers[0].recipe.text='Edited';assert.equal(out.photos[0].committed.textLayers[0].recipe.text,'Committed');assert.equal(input.photos[0].settings.textLayers[0].recipe.text,'Current 薄荷');
});
for(const version of [1,2,3,4,5,6,7,8])test(`actual rehashed schema${version} container migrates missing textLayers to [] in every slot`,async()=>{
 const input=await fixture(),encoded=await P.encode(input),legacy=rewrite(encoded,doc=>{doc.version=version;for(const p of doc.photos){if(version<6)delete p.review;for(const s of slots(p))delete s.textLayers;}}),before=sha(legacy),out=await P.decode(legacy);
 assert.equal(out.version,P.VERSION);for(const s of slots(out.photos[0]))assert.deepEqual(s.textLayers,[]);assert.deepEqual(out.photos[0].source.bytes,input.photos[0].source.bytes);assert.equal(sha(legacy),before);assert.equal(P.inspectHeader(await P.encode(out)).version,P.VERSION);
});
for(let i=0;i<5;i++)test(`schema9 slot${i} requires textLayers on write and on correctly rehashed decode`,async()=>{
 const input=await fixture(),encoded=await P.encode(input);delete slots(input.photos[0])[i].textLayers;await assert.rejects(P.encode(input),/Missing settings field: textLayers/);await assert.rejects(P.decode(rewrite(encoded,doc=>delete slots(doc.photos[0])[i].textLayers)),/Missing settings field: textLayers/);
});
test('invalid present textLayers rejects in all current and legacy versions, including every history slot',async()=>{
 const encoded=await P.encode(await fixture());for(let version=1;version<=9;version++)for(let i=0;i<5;i++)for(const invalid of [null,{},[{id:'bad',enabled:true,recipe:{version:1}}]]){
  const tampered=rewrite(encoded,doc=>{doc.version=version;if(version<6)delete doc.photos[0].review;slots(doc.photos[0])[i].textLayers=invalid;});await assert.rejects(P.decode(tampered),/text layers/i);
 }
});
test('text getters/prototypes/symbols/sparse arrays are refused without being read by project validation',()=>{
 let reads=0;const s=settings('Text');Object.defineProperty(s.textLayers[0].recipe,'text',{enumerable:true,get(){reads++;return 'text';}});assert.throws(()=>P.validateSettings(s,{width:11,height:7},'source:1'));assert.equal(reads,0);
 const array=[];Object.defineProperty(array,'0',{enumerable:true,get(){reads++;return settings('Text').textLayers[0];}});assert.throws(()=>P.validateSettings({...settings(),textLayers:array},{width:11,height:7},'source:1'));assert.equal(reads,0);
 const sym=[];sym[Symbol('x')]=true;for(const textLayers of [sym,new Array(1),Object.assign(Object.create({x:1}),[])])assert.throws(()=>P.validateSettings({...settings(),textLayers},{width:11,height:7},'source:1'));
 const getter=settings();Object.defineProperty(getter,'textLayers',{enumerable:true,get(){reads++;return [];}});assert.throws(()=>P.validateSettings(getter,{width:11,height:7},'source:1'));assert.equal(reads,0);
});
test('schema9 snapshots all recipe values before asynchronous digest; storage is not restricted to render budget',async()=>{
 const input=await fixture(),before=structuredClone(input);let first=true;const encoded=await P.encode(input,{sha256:async bytes=>{if(first){first=false;for(const s of slots(input.photos[0]))for(const l of s.textLayers)l.recipe.text='Changed during hash';}return sha(bytes);}});assert.deepEqual(slots((await P.decode(encoded)).photos[0]),slots(before.photos[0]));
 assert.equal(P.validateSettings(settings('Can retain large source'),{width:15000,height:15000},'source:1').textLayers[0].recipe.text,'Can retain large source');
});
test('browser UMD project codec persists active text with WebCrypto and shared validator without Node',async()=>{
 const input=await fixture();input.photos[0].source.bytes=Array.from(input.photos[0].source.bytes);const c=vm.createContext({crypto:crypto.webcrypto,TextEncoder,TextDecoder,Uint8Array,Uint16Array,Float32Array,ArrayBuffer,DataView,inputJSON:JSON.stringify(input)});
 for(const file of ['text-overlay.cjs','text-layers.cjs','photo-review.cjs','project-document.cjs'])vm.runInContext(fs.readFileSync(require.resolve('../src/'+file),'utf8'),c);
 vm.runInContext('const input=JSON.parse(inputJSON);input.photos[0].source.bytes=Uint8Array.from(input.photos[0].source.bytes);globalThis.output=MintProjectDocument.encode(input).then(bytes=>MintProjectDocument.decode(bytes));',c);const out=await c.output;assert.equal(out.version,P.VERSION);assert.deepEqual(JSON.parse(JSON.stringify(slots(out.photos[0]))),slots(input.photos[0]));
});
