'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const crypto=require('node:crypto');
const {createDesktopAI}=require('../desktop-ai.cjs');
const {CLASSES}=require('../backend/adapters/segface/mask.cjs');
function provenance(context,task='parse'){
 return{jobId:context.jobId,task,modelId:context.modelId,modelVersion:context.modelVersion,weightsSha256:'a'.repeat(64),kind:'test-double',device:{kind:context.device,name:'fixture CPU'},
  executionProfile:task==='parse'?{adapter:'segface',variant:'mobilenet',inputSize:512,precision:'float32',threads:2,qualityProfile:'face-parsing-512'}:
   {adapter:'birefnet',inputSize:2048,precision:'float32',threads:4,qualityProfile:'hr-2048'},...(task==='parse'?{selection:{...context.selection}}:{})};
}
function fixture(context,task='parse'){
 const {width,height}=context.roi,pixels=width*height;
 if(task==='matting')return{matte:{width,height,roi:{...context.roi},space:'roi-original-pixels',encoding:'unit-float32',data:new Float32Array(pixels).fill(0.5)},provenance:provenance(context,task)};
 const data=new Float32Array(pixels*CLASSES.length);
 for(let p=0;p<pixels;p++){data[CLASSES.indexOf('skin')*pixels+p]=0.3;data[CLASSES.indexOf('nose')*pixels+p]=0.2;data[p]=0.5;}
 return{kind:'parsing',width,height,roi:{...context.roi},layout:'planar',space:'roi-original-pixels',encoding:'unit-float32',classes:[...CLASSES],data,provenance:provenance(context)};
}
function harness(run=async(context,task)=>fixture(context,task)){
 let config,context,disposed=0,cancelled=0;
 const ai=createDesktopAI({root:path.resolve('/app'),catalog:()=>[],backendFactory:value=>{config=value;return{probe:async()=>({runtime:{available:false}}),runParsing:async request=>{context=request;return run(request,'parse');},runMatting:async request=>{context=request;return run(request,'matting');},cancelAll(){cancelled++;},dispose(){disposed++;}};}});
 return{ai,getConfig:()=>config,getContext:()=>context,counts:()=>({disposed,cancelled})};
}
const request=()=>({requestId:'image_job_1',modelId:'segface',modelVersion:'pinned',device:'cpu',originalSize:{width:20,height:20},roi:{x:2,y:2,width:3,height:3},source:{width:3,height:3,format:'rgba8',alphaMode:'straight',colorSpace:'srgb',data:new Uint8ClampedArray(36).fill(127)},selection:{kind:'detected-face',faceId:'face-0',revision:'photo-1-revision-0'}});
const matteRequest=()=>{const value=request();delete value.selection;value.modelId='birefnet';return value;};
test('privileged Python/worker paths are derived from application roots, never renderer commands',()=>{
 const h=harness(),c=h.getConfig();assert.equal(c.backendRoot,path.resolve('/app/backend'));assert.ok(c.pythonPath.endsWith('/backend/.venv/bin/python'));
 assert.equal(c.maxConcurrent,1);assert.equal(c.maxQueued,2);h.ai.dispose();
});
test('bridge rejects extra command/path/approval fields and unsupported device before execution',async()=>{
 const h=harness();for(const key of ['pythonPath','modelRoot','command','executionApproved','apiKey'])await assert.rejects(h.ai.parse({...request(),[key]:'untrusted'}),/Unexpected/);
 await assert.rejects(h.ai.parse({...request(),device:'auto'}),/CPU/);assert.equal(h.getContext(),undefined);
});
test('parse requires explicit bounded face selection and forwards only whitelisted identity',async()=>{
 const h=harness();await assert.rejects(h.ai.parse({...request(),selection:undefined}),/人脸/);
 await assert.rejects(h.ai.parse({...request(),selection:{kind:'whole-image',faceId:'a',revision:'b'}}),/人脸/);
 const value=request();value.selection.path='/ignored';await h.ai.parse(value);
 assert.deepEqual(h.getContext().selection,{kind:'detected-face',faceId:'face-0',revision:'photo-1-revision-0'});assert.notEqual(h.getContext().jobId,value.requestId);
});
test('duplicate request IDs cannot replace a running job, cancellation drops a late result',async()=>{
 let resolve;const h=harness(()=>new Promise(r=>resolve=r));const job=h.ai.parse(request());
 await assert.rejects(h.ai.parse(request()),/already running/);assert.equal(h.ai.cancel('unknown'),false);assert.equal(h.ai.cancel('image_job_1'),true);
 assert.equal(h.getContext().signal.aborted,true);resolve({unexpected:'late'});await assert.rejects(job,{name:'AbortError'});
});
test('dispose is idempotent, aborts pending parsing and blocks subsequent model work',async()=>{
 let resolve;const h=harness(()=>new Promise(r=>resolve=r));const job=h.ai.parse(request());h.ai.dispose();h.ai.dispose();
 assert.equal(h.getContext().signal.aborted,true);resolve({late:true});await assert.rejects(job,{name:'AbortError'});
 await assert.rejects(h.ai.probe(),/关闭/);assert.deepEqual(h.counts(),{disposed:1,cancelled:0});
});
test('matting bridge returns alpha-only original-ROI data and never changes source bytes',async()=>{
 const h=harness(),value=matteRequest(),before=new Uint8ClampedArray(value.source.data);
 const result=await h.ai.matte(value);
 assert.deepEqual(result.matte.roi,value.roi);assert.equal(result.matte.data.length,9);assert.ok(result.matte.data.every(v=>v===0.5));
 assert.equal(result.image,undefined);assert.equal(h.getContext().selection,undefined);assert.equal(h.getContext().mask,undefined);
 assert.deepEqual(value.source.data,before);assert.notEqual(h.getContext().source.data,value.source.data);
 assert.equal(result.provenance.task,'matting');assert.equal(result.provenance.modelId,'birefnet');
 assert.deepEqual(result.provenance.executionProfile,{adapter:'birefnet',inputSize:2048,precision:'float32',threads:4,qualityProfile:'hr-2048'});
});
test('compact face masks use explicit skin+nose policy and keep exact vocabulary/provenance without full planes',async()=>{
 const h=harness(),value=request(),result=await h.ai.parseMasks(value);
 assert.equal(result.kind,'face-masks');assert.deepEqual(result.roi,value.roi);
 assert.equal(result.skin.length,9);assert.equal(result.protected.length,9);assert.equal(result.data,undefined);assert.equal(result.classes,undefined);
 for(let p=0;p<9;p++){assert.equal(result.skin[p],0);assert.equal(result.protected[p],1);}
 assert.deepEqual(result.provenance.classVocabulary,[...CLASSES]);assert.deepEqual(result.provenance.maskClasses.skin,['skin','nose']);
 assert.deepEqual(result.provenance.maskClasses.protected,CLASSES.filter(c=>!['skin','nose'].includes(c)));
 assert.equal(result.provenance.maskPolicy.version,'segface-conservative-v1');
 assert.deepEqual(result.provenance.maskPolicy.confidence,{low:0.65,full:0.95,curve:'smoothstep-clamped-to-guarded-probability'});
 assert.equal(result.provenance.maskPolicy.guard.units,'original-roi-pixels');assert.equal(result.provenance.maskPolicy.guard.outsideRoi,'fully-protected');
 const raw=await h.ai.parse({...request(),requestId:'raw_debug'});assert.equal(raw.kind,'parsing');assert.equal(raw.data.length,9*19);
});
test('matting rejects paths, controls, face selection and malformed geometry before backend invocation',async()=>{
 const h=harness();
 for(const changes of [{selection:request().selection},{strength:0},{modelRoot:'/bad'},{roi:{x:19,y:2,width:3,height:3}},
  {source:{...matteRequest().source,data:new Float32Array(36)}},{originalSize:{width:NaN,height:20}}])await assert.rejects(h.ai.matte({...matteRequest(),...changes}));
 assert.equal(h.getContext(),undefined);
});
test('matting output validation rejects wrong shape/type/range/ROI or any changed-image result',async()=>{
 for(const change of [r=>r.matte.width++,r=>r.matte.roi.x++,r=>r.matte.data=new Uint8Array(9),r=>r.matte.data[0]=NaN,r=>r.matte.data[0]=1.01,r=>r.image={data:new Uint8Array(36)}]){
  const h=harness((context,task)=>{const result=fixture(context,task);change(result);return result;});
  await assert.rejects(h.ai.matte(matteRequest()));
 }
});
test('bridge rejects mismatched task/model/device/weights and wrong parsing vocabulary',async()=>{
 for(const change of [p=>p.task='parse',p=>p.modelId='other',p=>p.device.kind='cuda',p=>p.weightsSha256='not-a-hash']){
  const h=harness((context,task)=>{const result=fixture(context,task);change(result.provenance);return result;});
  await assert.rejects(h.ai.matte(matteRequest()),/provenance/);
 }
 const h=harness(context=>{const result=fixture(context);result.classes.reverse();return result;});
 await assert.rejects(h.ai.parseMasks(request()),/class mapping/);
});
test('matte and compact-parse requests share cancellation and cannot reuse an active request ID',async()=>{
 let resolve;const h=harness(()=>new Promise(r=>resolve=r));const pending=h.ai.matte(matteRequest());
 await assert.rejects(h.ai.parseMasks(request()),/already running/);assert.equal(h.ai.cancel('image_job_1'),true);
 resolve({late:true});await assert.rejects(pending,{name:'AbortError'});
 const second=h.ai.parseMasks(request());h.ai.cancelAll();resolve({late:true});await assert.rejects(second,{name:'AbortError'});
 assert.equal(h.counts().cancelled,1);
});
test('source and selection are snapshotted before async work and output arrays are independent',async()=>{
 let finish;const h=harness(context=>new Promise(resolve=>{finish=()=>resolve(fixture(context));}));
 const value=request(),pending=h.ai.parseMasks(value);value.source.data.fill(0);value.roi.x=0;value.selection.revision='mutated';
 assert.equal(h.getContext().source.data[0],127);assert.equal(h.getContext().roi.x,2);finish();
 const result=await pending;assert.equal(result.provenance.selection.revision,'photo-1-revision-0');assert.equal(result.roi.x,2);
});
function refinedFixture(context){
 const result=fixture(context,'matting');result.foreground={...context.source,data:new Uint8ClampedArray(context.source.data)};
 result.provenance.foregroundRefinement={kind:'classical-color-estimation',implementation:'pymatting',version:'1.1.16',method:'estimate_foreground_ml',workingColorSpace:'linear-srgb',sourceDigest:crypto.createHash('sha256').update(context.source.data).digest('hex'),alphaDigest:crypto.createHash('sha256').update(Buffer.from(result.matte.data.buffer)).digest('hex')};
 return result;
}
test('bridge preserves separately declared optional foreground and classical provenance',async()=>{
 const h=harness(context=>refinedFixture(context)),value=matteRequest(),result=await h.ai.matte(value);
 assert.deepEqual(result.foreground.data,value.source.data);assert.notEqual(result.foreground.data,value.source.data);
 assert.equal(result.provenance.foregroundRefinement.implementation,'pymatting');assert.equal(result.provenance.foregroundRefinement.version,'1.1.16');
});
test('bridge rejects malformed optional foreground and preserves source alpha/RGB constraints',async()=>{
 for(const mutate of [r=>r.provenance.foregroundRefinement.sourceDigest='0'.repeat(64),r=>r.matte.data[0]=0.7,r=>r.provenance.foregroundRefinement.alphaDigest='0'.repeat(64),r=>r.foreground.data[3]++,r=>r.foreground.data[0]++,r=>r.foreground.alphaMode='premultiplied',r=>r.foreground.width++,
   r=>r.provenance.foregroundRefinement.version='other',r=>delete r.provenance.foregroundRefinement,r=>delete r.foreground]){
  const h=harness(context=>{const r=refinedFixture(context);mutate(r);return r;});await assert.rejects(h.ai.matte(matteRequest()));
 }
});
