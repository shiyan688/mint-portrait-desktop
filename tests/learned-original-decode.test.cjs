'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(width,height){
 let canvases=0,closed=0,draws=0;
 const context=vm.createContext({console,URL,DOMException,Blob,Uint8ClampedArray,Float32Array,AbortController,createImageBitmap:async()=>({width,height,close:()=>closed++}),
  document:{createElement(){canvases++;return{getContext:()=>({drawImage(){draws++;}})};}}});
 let source=fs.readFileSync(require.resolve('../src/pipeline.js'),'utf8').replace(/^import .*;$/m,'').replaceAll('import.meta.url',JSON.stringify('mint://app/src/pipeline.js')).replace(/^export /gm,'');
 vm.runInContext(source+'\nglobalThis.api={decodeImage,decodeOriginalImage};',context);
 return{api:context.api,counts:()=>({canvases,closed,draws})};
}
test('learned model decode retains exact original dimensions within explicit limits',async()=>{
 const h=harness(2400,1600),r=await h.api.decodeOriginalImage(new Blob(['pixels']));
 assert.equal(r.width,2400);assert.equal(r.height,1600);assert.equal(r.scaled,false);assert.deepEqual(h.counts(),{canvases:1,closed:1,draws:1});
});
test('oversized learned input is rejected before canvas allocation, never a resized fake original',async()=>{
 for(const [w,h]of [[6000,4000],[4096,4096],[5000,100]]){const x=harness(w,h);await assert.rejects(x.api.decodeOriginalImage(new Blob(['pixels'])),/不会把缩略图冒充原图/);assert.deepEqual(x.counts(),{canvases:0,closed:1,draws:0});}
});
test('cancelled original decoding releases bitmap and does not draw',async()=>{
 const h=harness(200,100),c=new AbortController();c.abort();
 await assert.rejects(h.api.decodeOriginalImage(new Blob(['pixels']),{signal:c.signal}),{name:'AbortError'});assert.deepEqual(h.counts(),{canvases:0,closed:1,draws:0});
});
test('legacy preview resizing remains explicit and is not confused with original pixels',async()=>{
 const h=harness(6000,4000),r=await h.api.decodeImage(new Blob(['pixels']),1280);assert.equal(r.width,1280);assert.equal(r.originalWidth,6000);assert.equal(r.scaled,true);
});
