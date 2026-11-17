'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const engine=require('../src/portrait-engine.cjs');
const worker=fs.readFileSync(require.resolve('../src/pixel-worker.js'),'utf8');
function image(){return{width:3,height:1,data:new Uint8ClampedArray([0,0,0,255,0,0,0,255,29,79,129,120])};}
function facts(){return{sourceRevision:'s1',learnedMatte:{cacheId:'m1',sourceRevision:'s1',originalSize:{width:3,height:1},provenance:{kind:'model',task:'matting',modelId:'birefnet',weightsSha256:'a'.repeat(64)}},mask:{width:3,height:1,data:new Float32Array([0,.5,1]),space:'working-pixels',learnedMatteId:'m1'}};}
function run(settings,analysis){let output;const c=vm.createContext({Uint8ClampedArray,Uint8Array,Float32Array,Float64Array,ArrayBuffer,console});c.MintLocalAdjustments=require('../src/local-adjustments.cjs');c.MintStraighten=require('../src/straighten.cjs');c.MintSharpness=require('../src/sharpness.cjs');for(const file of ['image-overlay.cjs','image-layers.cjs'])vm.runInContext(fs.readFileSync(require.resolve('../src/'+file),'utf8'),c);c.self=c;c.importScripts=()=>{c.PortraitEngine=engine;};c.postMessage=r=>{output=r;};vm.runInContext(worker,c);const im=image();c.onmessage({data:{...im,buffer:im.data.buffer,settings,analysis}});if(output.error)throw new Error(output.error);return new Uint8ClampedArray(output.buffer);}
test('learned matte export preserves exact continuous alpha and all original RGB',()=>{
 const im=image(),out=run({bgMode:'transparent',learnedMatteId:'m1',bgFeather:20},facts());
 assert.deepEqual([...out],[0,0,0,0,0,0,0,128,29,79,129,120]);assert.equal(im.data[7],255);
});
test('learned alpha uses linear-light compositing, not gamma-dark interpolation or dilation',()=>{
 const out=run({bgMode:'color',bgColor:'#ffffff',learnedMatteId:'m1',bgFeather:20},facts());
 assert.deepEqual([...out.slice(0,4)],[255,255,255,255]);
 assert.ok(out[4]>=187&&out[4]<=189);assert.equal(out[4],out[5]);assert.equal(out[7],255);
});
test('enabled missing, stale or wrong-sized learned masks fail closed, even if a legacy mask exists',()=>{
 for(const f of [null,{mask:facts().mask},{...facts(),sourceRevision:'different'},{...facts(),mask:{...facts().mask,width:1}}]) assert.throws(()=>run({learnedMatteId:'m1',bgMode:'color'},f),/蒙版/);
 assert.throws(()=>run({learnedMatteId:'other',bgMode:'color'},facts()),/蒙版/);
 const f=facts();f.mask.data[0]=NaN;assert.throws(()=>run({learnedMatteId:'m1'},f),/概率/);
});
test('original background does not mutate source bytes even with an approved learned matte',()=>{
 assert.deepEqual(run({learnedMatteId:'m1',bgMode:'original'},facts()),image().data);
});
