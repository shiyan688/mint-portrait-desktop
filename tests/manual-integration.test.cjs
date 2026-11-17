'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp'),crypto=require('node:crypto');
const P=require('../src/project-document.cjs'),M=require('../src/manual-tools.cjs'),L=require('../src/local-adjustments.cjs'),Core=require('../export-render-core.cjs'),{createExportRenderer}=require('../export-renderer.cjs');
const rev='photo-1:source-0';
const recipe=()=>({version:1,sourceRevision:rev,base:'none',inverted:false,feather:.015,commands:[{kind:'lasso',mode:'add',points:[{x:.2,y:.2},{x:.75,y:.2},{x:.75,y:.8},{x:.2,y:.8}]}]});
const stroke=()=>({kind:'push',sourceRevision:rev,radius:.22,strength:.5,points:[{x:.4,y:.5},{x:.49,y:.5}],selection:recipe()});
const settings=extra=>({...P.DEFAULT_SETTINGS,spots:[],localLayers:[],manualLiquify:[],manualRepair:[],...extra});
function picture(w=128,h=96){const data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){let i=(y*w+x)*4;data.set([30+(x*5)%200,40+(y*7)%180,100+(x+y)%100,255],i);}return{width:w,height:h,data};}
async function png(image){return sharp(Buffer.from(image.data),{raw:{width:image.width,height:image.height,channels:4}}).png().toBuffer();}
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const layer=()=>({id:'local-1',name:'Selected exposure',enabled:true,opacity:.7,sourceRevision:rev,adjustments:{exposure:20,contrast:0,saturation:0,temperature:0},mask:{kind:'selection',selection:recipe()}});
test('selection-backed tone layer affects only selected pixels and preserves source/alpha',()=>{
 const input=picture(),before=input.data.slice(),r=recipe(),mask=M.rasterizeSelection(input.width,input.height,r,{sourceRevision:rev}),out=L.apply(input,[layer()],{sourceRevision:rev});let changed=0;
 for(let j=0;j<mask.length;j++){const i=j*4;assert.equal(out.data[i+3],input.data[i+3]);if(mask[j]===0)assert.deepEqual(out.data.subarray(i,i+4),input.data.subarray(i,i+4));else if(out.data[i]!==input.data[i])changed++;}
 assert.ok(changed>100);assert.deepEqual(input.data,before);const original=layer();const saved=L.validateLayers([original],{sourceRevision:rev});original.mask.selection.commands[0].points[0].x=.9;assert.equal(saved[0].mask.selection.commands[0].points[0].x,.2);
});
test('projectv3 preserves original bytes, current selection and per-stroke snapshots independently',async()=>{
 const image=picture(),bytes=new Uint8Array(await png(image)),s=settings({manualSelection:recipe(),manualLiquify:[stroke()],localLayers:[layer()]}),photo={id:'photo-1',name:'source.png',sourceRevision:rev,source:{bytes,mime:'image/png',width:image.width,height:image.height},selected:true,settings:s,committed:structuredClone(s),undo:[settings()],redo:[],revision:1,preset:null,imageAssets: [], learnedCache:[]};
 const out=await P.decode(await P.encode({version:P.VERSION,currentId:photo.id,photos:[photo]}));assert.equal(out.version,P.VERSION);assert.deepEqual(out.photos[0].source.bytes,bytes);assert.deepEqual(out.photos[0].settings,s);
 out.photos[0].settings.manualSelection.commands[0].points[0].x=.6;assert.equal(out.photos[0].settings.manualLiquify[0].selection.commands[0].points[0].x,.2);assert.equal(out.photos[0].committed.manualSelection.commands[0].points[0].x,.2);
 photo.settings.manualLiquify[0].sourceRevision='other';await assert.rejects(P.encode({version:P.VERSION,currentId:photo.id,photos:[photo]}),/revision/);
});
test('native PNG export replays selected local color and liquify at exact dimensions with immutable input',async()=>{
 const input=picture(),bytes=await png(input),hash=digest(bytes),s=settings({manualSelection:recipe(),manualLiquify:[stroke()],localLayers:[layer()]}),service=createExportRenderer();
 try{const result=await service.render({requestId:'manual-native',bytes,sourceRevision:rev,settings:s,analysis:{landmarks:[],sourceRevision:rev},mode:'original',format:'png',quality:.9});const got=await sharp(Buffer.from(result.bytes)).raw().ensureAlpha().toBuffer();const expected=Core.processPixels(input,s,{landmarks:[],sourceRevision:rev,originalSize:{width:input.width,height:input.height}});assert.deepEqual(got,Buffer.from(expected.data));assert.equal(result.width,input.width);assert.equal(result.height,input.height);assert.equal(result.scaled,false);assert.equal(digest(bytes),hash);assert.notDeepEqual(got,Buffer.from(input.data));}finally{service.dispose();}
});
test('current selection alone never edits pixels or imposes manual-operation export ceiling',()=>{
 const input=picture(),s=settings({manualSelection:recipe()}),out=Core.processPixels(input,s,{landmarks:[],sourceRevision:rev});assert.deepEqual(out.data,input.data);assert.equal(Core.sizePlan(6000,4000,'original',s).scaled,false);
 assert.throws(()=>Core.sizePlan(6000,4000,'original',settings({manualLiquify:[stroke()]})),/1600/);
 assert.throws(()=>Core.sizePlan(6000,4000,'original',settings({localLayers:[layer()]})),/1600/);
});
test('selection layer rejects null mask and cross-photo recipes before output mutation',()=>{
 const a=layer();a.mask.selection=null;assert.throws(()=>L.validateLayers([a],{sourceRevision:rev}),/selection/);const b=layer();b.mask.selection.sourceRevision='other';assert.throws(()=>L.apply(picture(),[b],{sourceRevision:rev}),/revision/);
});
test('stale background/automatic geometry is rejected by schema and replay, not merely hidden in UI',()=>{
 const input=picture(),base=settings({manualLiquify:[stroke()]});
 for(const patch of [{bgMode:'transparent'},{bgMode:'blur'},{slim:10},{eyes:1},{nose:-3},{jaw:2}]){
  const s={...base,...patch};assert.throws(()=>P.validateSettings(s,{width:input.width,height:input.height},rev),e=>e.code==='MANUAL_STALE_ANALYSIS');
  assert.throws(()=>Core.processPixels(input,s,{landmarks:[],sourceRevision:rev}),e=>e.code==='MANUAL_STALE_ANALYSIS');
 }
 const bridge=require('../src/manual-pipeline.cjs');assert.throws(()=>bridge.assertCompatible({...base,manualRepair:[{sampleMode:'automatic'}]}),e=>e.code==='MANUAL_STALE_ANALYSIS');
 assert.doesNotThrow(()=>bridge.assertCompatible({...base,manualRepair:[{sampleMode:'manual'}]}));
});
test('explicit clone plus liquify survives project roundtrip and actual native export with exact source preservation',async()=>{
 const Repair=require('../src/repair-brush-core.cjs'),input=picture(),bytes=new Uint8Array(await png(input));
 const command={version:1,type:'repair-stroke',mode:'clone',sourceRevision:rev,radius:.03,hardness:.4,strength:.65,points:[{x:.51,y:.5},{x:.53,y:.52}],source:{x:.3,y:.3},sampleMode:'manual',selection:recipe()};
 const s=settings({manualLiquify:[stroke()],manualRepair:[command]});const expected=Core.processPixels(input,s,{landmarks:[],sourceRevision:rev});
 const photo={id:'photo-1',name:'source.png',sourceRevision:rev,source:{bytes,mime:'image/png',width:input.width,height:input.height},selected:true,settings:s,committed:structuredClone(s),undo:[settings()],redo:[],revision:1,preset:null,imageAssets: [], learnedCache:[]};
 const decoded=await P.decode(await P.encode({version:P.VERSION,currentId:photo.id,photos:[photo]}));assert.deepEqual(decoded.photos[0].settings.manualRepair,[Repair.validate(command,{sourceRevision:rev,manualTools:M})]);assert.deepEqual(decoded.photos[0].source.bytes,bytes);
 const service=createExportRenderer();try{const out=await service.render({requestId:'manual-clone',bytes,sourceRevision:rev,settings:decoded.photos[0].settings,analysis:{sourceRevision:rev,landmarks:[]},mode:'original',format:'png',quality:.9});const got=await sharp(Buffer.from(out.bytes)).ensureAlpha().raw().toBuffer();assert.deepEqual(got,Buffer.from(expected.data));assert.notDeepEqual(got,Buffer.from(input.data));}finally{service.dispose();}
});
