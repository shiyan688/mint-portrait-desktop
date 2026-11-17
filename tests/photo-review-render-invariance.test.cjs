'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),sharp=require('sharp');
const P=require('../src/project-document.cjs'),R=require('../src/photo-review.cjs'),G=require('../src/geometry.cjs'),{createExportRenderer}=require('../export-renderer.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
test('rating/filter/sort/project roundtrip leave real original-resolution PNG export byte-identical',async()=>{
 const width=79,height=61,raw=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)raw.set([(x*7+y*3)%256,(x*3+y*11)%256,(x*17+y*7)%256,(x+y)%4===0?128:255],(y*width+x)*4);
 const bytes=await sharp(raw,{raw:{width,height,channels:4}}).png().toBuffer(),originalHash=sha(bytes),settings={...P.DEFAULT_SETTINGS,spots:[],localLayers:[],manualLiquify:[],manualRepair:[],exposure:9,contrast:7,framing:{...G.defaults(),crop:{x:.12,y:.16,w:.7,h:.6},quarterTurns:1,flipX:true}},sourceRevision='review-source:0';
 const p={id:'photo1',name:'frame010.png',sourceRevision,source:{bytes:new Uint8Array(bytes),mime:'image/png',width,height},settings,committed:structuredClone(settings),undo:[{...settings,framing:null}],redo:[],selected:true,revision:0,preset:null,learnedCache:[],review:R.defaults()},before=structuredClone(p),service=createExportRenderer();
 const request=photo=>({requestId:'review-export',bytes:photo.source.bytes,sourceRevision:photo.sourceRevision,settings:photo.settings,analysis:{landmarks:[],sourceRevision:photo.sourceRevision},mode:'original',format:'png',quality:.95});
 try {
  const first=await service.render(request(p));
  for(let i=0;i<250;i++){p.review=R.edit(p.review,{rating:i%6,flag:['none','pick','reject'][i%3],label:['none','red','blue'][i%3]});p.revision++;R.query([{id:p.id,name:p.name,review:p.review,selected:p.selected}],{...R.viewDefaults(),hideRejected:i%2===0,minRating:i%6,sort:['import','name','rating-desc','rating-asc'][i%4]});}
  p.review=R.redo(R.undo(p.review));const restored=(await P.decode(await P.encode({version:6,currentId:p.id,photos:[p]}))).photos[0],second=await service.render(request(restored));
  assert.equal(sha(second.bytes),sha(first.bytes));assert.equal(sha(bytes),originalHash);assert.equal(sha(restored.source.bytes),originalHash);assert.deepEqual(restored.settings,before.settings);assert.deepEqual(restored.committed,before.committed);assert.deepEqual(restored.undo,before.undo);assert.deepEqual(restored.redo,before.redo);assert.equal(restored.sourceRevision,before.sourceRevision);
  const a=await sharp(first.bytes).raw().toBuffer({resolveWithObject:true}),b=await sharp(second.bytes).raw().toBuffer({resolveWithObject:true});assert.deepEqual(b,a);const plan=G.plan(width,height,settings.framing);assert.equal(b.info.width,plan.outputSize.width);assert.equal(b.info.height,plan.outputSize.height);
 } finally { service.dispose(); }
});
