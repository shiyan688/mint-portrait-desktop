'use strict';
// Every provider, pixel codec and network response below is a TEST DOUBLE.
// Passing these tests proves contracts/request construction, NOT live inference or quality.
const test = require('node:test'), assert = require('node:assert/strict');
const G = require('../backend/adapters/generative/index.cjs');
function pixels(w=16,h=16,r=10) { const data = new Uint8ClampedArray(w*h*4); for(let i=0;i<w*h;i++) data.set([r,20,30,i%256],i*4); return {width:w,height:h,format:'rgba8',alphaMode:'straight',colorSpace:'srgb',data}; }
function selection(src, value=1) { return {width:src.width,height:src.height,space:'original-pixels',encoding:'unit-float32',data:new Float32Array(src.width*src.height).fill(value)}; }
// Intentionally NOT a production PNG implementation: mock header + raw RGBA bytes.
const codec = {
  encodePNG(im) { const b=Buffer.alloc(24+im.data.length); Buffer.from([137,80,78,71,13,10,26,10]).copy(b); b.write('IHDR',12); b.writeUInt32BE(im.width,16); b.writeUInt32BE(im.height,20); Buffer.from(im.data).copy(b,24); return b; },
  decodePNG(b) { const im=pixels(b.readUInt32BE(16),b.readUInt32BE(20)); im.data.set(b.subarray(24)); return im; },
  resizeRGBA(im,w,h) { return pixels(w,h,im.data[0]); }
};
function deferred() { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; }
const tick = () => new Promise(r=>setImmediate(r));
function fake(run = async()=>({png:codec.encodePNG(pixels(16,16,200)),requestId:'mock-request'})) {
  return {descriptor:Object.freeze({id:'test-only',name:'TEST DOUBLE',enabled:true,models:['mock-model'],nativeMask:true,endpoint:'https://test.invalid',pricingUrl:'https://test.invalid/pricing'}),run};
}
function make(provider=fake(),extra={}) {
  const image=pixels();
  const session=G.createGenerativeSession({image,photoRevision:'photo-1-rev-1',codec,providers:[provider],confirmUpload:async s=>({approved:true,preparedId:s.preparedId,requestDigest:s.requestDigest}),...extra});
  const request={task:'inpaint',providerId:provider.descriptor.id,model:provider.descriptor.models[0],prompt:'Remove selected object',mask:selection(image),strength:1};
  return {session,request,image};
}
function json(value,headers={}) { return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json',...headers}}); }
function providerRequest(overrides={}) { return {task:'instruction-edit',model:G.OPENAI_MODELS[0],prompt:'Edit mock',sourcePng:codec.encodePNG(pixels()),maskPng:null,outputSize:{width:1024,height:1024},quality:'high',signal:new AbortController().signal,...overrides}; }

test('providers are disabled by default, imports and listing never resolve keys/fetch',async()=>{
  let calls=0; const provider=G.createOpenAIProvider({getApiKey:()=>{calls++;return 'mock';},fetchImpl:()=>{calls++;throw Error('unexpected');}});
  assert.equal(provider.descriptor.enabled,false);
  await assert.rejects(provider.run(providerRequest()),{code:'PROVIDER_DISABLED'});
  const {session,request}=make(provider); await assert.rejects(session.prepare(request),{code:'PROVIDER_DISABLED'}); assert.equal(calls,0);
});
test('OpenAI builds real official multipart shape, one result, exact model; mock only',async()=>{
  let count=0;
  const p=G.createOpenAIProvider({enabled:true,getApiKey:async()=> 'FAKE_TEST_KEY',fetchImpl:async(url,init)=>{
    count++; assert.equal(url,'https://api.openai.com/v1/images/edits'); assert.equal(init.method,'POST'); assert.equal(init.redirect,'error');
    assert.equal(init.headers.Authorization,'Bearer FAKE_TEST_KEY'); assert.equal(init.body.get('model'),G.OPENAI_MODELS[0]);
    assert.equal(init.body.get('n'),'1'); assert.equal(init.body.get('quality'),'high'); assert.equal(init.body.get('size'),'1024x1024'); assert.equal(init.body.get('output_format'),'png');
    assert.equal(init.body.get('image[]').name,'source.png'); assert.equal(init.body.get('mask').name,'mask.png');
    return json({data:[{b64_json:codec.encodePNG(pixels()).toString('base64')}]},{'x-request-id':'req_mock_1'});
  }});
  const out=await p.run(providerRequest({task:'inpaint',maskPng:codec.encodePNG(pixels())})); assert.equal(out.requestId,'req_mock_1'); assert.equal(count,1);
});
test('provider failures are sanitized and never retried',async()=>{
  let calls=0; const p=G.createOpenAIProvider({enabled:true,getApiKey:()=> 'FAKE_SECRET',fetchImpl:async()=>{calls++;throw Error('FAKE_SECRET photo-data prompt https://private');}});
  await assert.rejects(p.run(providerRequest()),e=>e.code==='GENERATION_FAILED'&&!e.message.includes('FAKE_SECRET')&&!e.cause);
  assert.equal(calls,1);
});
test('OpenAI rejects foreign response shapes, invalid PNG and oversized body',async()=>{
  for(const body of [{data:[{url:'https://evil.invalid'}]},{data:[{b64_json:Buffer.from('bad').toString('base64')}]},{data:[]}]){
    const p=G.createOpenAIProvider({enabled:true,getApiKey:()=> 'mock',fetchImpl:async()=>json(body)});
    await assert.rejects(p.run(providerRequest()),{code:'INVALID_OUTPUT'});
  }
  const p=G.createOpenAIProvider({enabled:true,getApiKey:()=> 'mock',fetchImpl:async()=>new Response('{}',{headers:{'content-length':String(100*1024*1024)}})});
  await assert.rejects(p.run(providerRequest()),{code:'INVALID_OUTPUT'});
});
test('Alibaba uses configured region/workspace, base64 input, constrained download without credential',async()=>{
  const calls=[];
  const p=G.createAlibabaProvider({enabled:true,workspaceId:'workspace-123',region:'cn-beijing',getApiKey:()=> 'MOCK_ALI_KEY',fetchImpl:async(url,init)=>{
    calls.push({url,init}); if(calls.length===1){ const b=JSON.parse(init.body); assert.equal(b.parameters.n,1); assert.equal(b.parameters.prompt_extend,false); assert.equal(b.parameters.size,'1024*1024'); assert.match(b.input.messages[0].content[0].image,/^data:image\/png;base64,/);
      return json({output:{choices:[{finish_reason:'stop',message:{content:[{image:'https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/mock.png?Expires=123'}]}}]},request_id:'mock_ali_1'}); }
    assert.equal(init.headers,undefined); assert.equal(init.redirect,'error'); return new Response(codec.encodePNG(pixels()));
  }});
  const out=await p.run(providerRequest({model:G.ALIBABA_MODELS[0]}));
  assert.equal(out.requestId,'mock_ali_1'); assert.match(calls[0].url,/workspace-123\.cn-beijing\.maas\.aliyuncs\.com/); assert.equal(calls.length,2);
});
test('Alibaba rejects missing workspace, arbitrary endpoint injection and native inpainting',async()=>{
  assert.throws(()=>G.createAlibabaProvider({enabled:true}),{code:'INVALID_CONFIG'});
  assert.throws(()=>G.createAlibabaProvider({workspaceId:'foo.evil.invalid'}),{code:'INVALID_CONFIG'});
  let calls=0; const p=G.createAlibabaProvider({enabled:true,workspaceId:'test',getApiKey:()=>{calls++;return 'mock';},fetchImpl:()=>{calls++;}});
  await assert.rejects(p.run(providerRequest({model:G.ALIBABA_MODELS[0],task:'inpaint'})),{code:'UNSUPPORTED_TASK'}); assert.equal(calls,0);
});
test('Alibaba rejects malicious signed-result hosts without fetching them',async()=>{
  for(const url of ['http://127.0.0.1/x','https://localhost/x','https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com.evil.invalid/x','https://user:pass@dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/x']){
    let calls=0; const p=G.createAlibabaProvider({enabled:true,workspaceId:'test',getApiKey:()=> 'mock',fetchImpl:async()=>{calls++;return json({output:{choices:[{finish_reason:'stop',message:{content:[{image:url}]}}]}});}});
    await assert.rejects(p.run(providerRequest({model:G.ALIBABA_MODELS[0]})),{code:'UNTRUSTED_OUTPUT_URL'}); assert.equal(calls,1);
  }
});
test('prepare never sends; trusted exact-request confirmation required; token consumed once',async()=>{
  let calls=0; const {session,request}=make(fake(async()=>{calls++;}),{confirmUpload:async s=>({approved:true,preparedId:s.preparedId,requestDigest:'wrong'})});
  const summary=await session.prepare(request); assert.equal(calls,0); assert.equal(summary.cost.hardCapEnforced,false);
  const job=session.start(summary.preparedId); await assert.rejects(job.result,{code:'CONSENT_REQUIRED'}); assert.equal(calls,0);
  assert.throws(()=>session.start(summary.preparedId),{code:'STALE_PREPARATION'});
});
test('renderer-style booleans cannot bypass absent trusted confirmation',async()=>{
  const {session,request}=make(fake(),{confirmUpload:null}); const p=await session.prepare(request);
  assert.throws(()=>session.start(p.preparedId,{confirmedUpload:true,confirmedCost:true}),{code:'CONFIRMATION_UNAVAILABLE'});
});
test('input snapshot, soft blend exactly once, zero-mask pixels and all alpha preserved; explicit accept',async()=>{
  const {session,request,image}=make(); request.mask.data[0]=0; request.mask.data[1]=0.5; request.strength=0.5;
  const p=await session.prepare(request); image.data.fill(255); request.mask.data.fill(1); request.prompt='mutated';
  const result=await session.start(p.preparedId).result;
  assert.deepEqual([...result.image.data.slice(0,4)],[10,20,30,0]); assert.equal(result.image.data[4],58);
  assert.equal(session.getOriginal().data[4],10); assert.equal(result.image.data[7],1);
  result.image.data.fill(99); const accepted=session.accept(result.candidateId); assert.equal(accepted.image.data[4],58);
  assert.throws(()=>session.accept(result.candidateId),{code:'STALE_CANDIDATE'}); assert.equal(session.getOriginal().data[4],10);
});
test('reject leaves original unchanged and invalidates candidate',async()=>{
  const {session,request}=make(); const p=await session.prepare(request); const r=await session.start(p.preparedId).result;
  assert.equal(session.reject(r.candidateId),true); assert.equal(session.getOriginal().data[0],10); assert.throws(()=>session.accept(r.candidateId),{code:'STALE_CANDIDATE'});
});
test('zero-edit and malformed masks fail before confirmation or transport',async()=>{
  const {session,request}=make(); await assert.rejects(session.prepare({...request,strength:0}),{code:'NO_EDIT'});
  request.mask.data[0]=NaN; await assert.rejects(session.prepare(request),{code:'INVALID_MASK'});
});
test('expired preparation and delayed confirmation do not send',async()=>{
  let clock=0,calls=0; const {session,request}=make(fake(async()=>{calls++;}),{now:()=>clock});
  const p=await session.prepare(request); clock=300001; assert.throws(()=>session.start(p.preparedId),{code:'CONSENT_EXPIRED'}); assert.equal(calls,0);
});
test('cancel before queue entry never opens dialog or contacts provider',async()=>{
  let confirms=0,calls=0; const {session,request}=make(fake(async()=>{calls++;}),{confirmUpload:()=>{confirms++;}});
  const p=await session.prepare(request),job=session.start(p.preparedId); job.cancel(); await assert.rejects(job.result,{code:'CANCELLED'}); await tick(); assert.equal(calls+confirms,0);
});
test('late ignored-abort response cannot publish; physical requests remain serialized',async()=>{
  const first=deferred(); let calls=0;
  const {session,request}=make(fake(async()=>{calls++; if(calls===1)return first.promise; return {png:codec.encodePNG(pixels(16,16,99))};}));
  const p1=await session.prepare(request),j1=session.start(p1.preparedId); const rejection=assert.rejects(j1.result,{code:'STALE_JOB'}); await tick(); assert.equal(calls,1);
  const p2=await session.prepare({...request,prompt:'new request'}),j2=session.start(p2.preparedId); await rejection; await tick(); assert.equal(calls,1); assert.equal(j2.state,'queued');
  first.resolve({png:codec.encodePNG(pixels(16,16,222))}); const r=await j2.result; assert.equal(calls,2); assert.equal(r.image.data[0],99);
});
test('editing photo while dialog awaits invalidates consent and prevents upload',async()=>{
  const gate=deferred(); let calls=0;
  const {session,request}=make(fake(async()=>{calls++;}),{confirmUpload:()=>gate.promise});
  const p=await session.prepare(request),job=session.start(p.preparedId); await tick(); session.invalidate();
  await assert.rejects(job.result,{code:'STALE_JOB'}); gate.resolve({approved:true,preparedId:p.preparedId,requestDigest:p.requestDigest}); await tick(); assert.equal(calls,0);
});
test('close/edit invalidates successful candidate',async()=>{
  const {session,request}=make(); const p=await session.prepare(request),r=await session.start(p.preparedId).result; session.dispose();
  assert.throws(()=>session.accept(r.candidateId),{code:'SESSION_CLOSED'});
});
test('dimension mismatch rejects unless explicit resize-to-source was disclosed',async()=>{
  const provider=fake(async()=>({png:codec.encodePNG(pixels(32,32,88))}));
  const a=make(provider); const p=await a.session.prepare(a.request); await assert.rejects(a.session.start(p.preparedId).result,{code:'GEOMETRY_MISMATCH'});
  const b=make(provider); const q=await b.session.prepare({...b.request,geometryPolicy:'resize-to-source'}); const out=await b.session.start(q.preparedId).result;
  assert.equal(out.image.width,16); assert.equal(out.provenance.transform,'explicit-resize-to-source'); assert.equal(out.image.data[3],0);
});
test('timeout rejects immediately; late result cannot become a candidate',async()=>{
  const gate=deferred(); const {session,request}=make(fake(()=>gate.promise),{timeoutMs:5});
  const p=await session.prepare(request),j=session.start(p.preparedId); await assert.rejects(j.result,{code:'TIMEOUT'}); gate.resolve({png:codec.encodePNG(pixels())}); await tick(); assert.equal(j.state,'cancelled');
});
test('size and quality validated before any API preparation',async()=>{
  const p=G.createOpenAIProvider({enabled:true,getApiKey:()=> 'mock',fetchImpl:()=>{throw Error('must not run');}}); const {session,request}=make(p);
  await assert.rejects(session.prepare(request),{code:'INVALID_REQUEST'});
  await assert.rejects(session.prepare({...request,outputSize:{width:1024,height:1024}}),{code:'GEOMETRY_MISMATCH'});
  const s=await session.prepare({...request,outputSize:{width:1024,height:1024},geometryPolicy:'resize-to-source'}); assert.equal(s.quality,'high');
});

test('delayed approval expiring while native dialog is open does not send',async()=>{
  const gate=deferred(); let clock=0,calls=0;
  const {session,request}=make(fake(async()=>{calls++;}),{now:()=>clock,confirmUpload:()=>gate.promise});
  const p=await session.prepare(request),job=session.start(p.preparedId); await tick(); clock=300001;
  gate.resolve({approved:true,preparedId:p.preparedId,requestDigest:p.requestDigest}); await assert.rejects(job.result,{code:'CONSENT_EXPIRED'}); assert.equal(calls,0);
});
test('newer preparation cannot be replaced by a slow encoder from an earlier request',async()=>{
  const delayed=deferred(); let count=0;
  const slow={...codec,encodePNG:im=>++count===1?delayed.promise:codec.encodePNG(im)};
  const {session,request}=make(fake(),{codec:slow}); const old=session.prepare(request); const stale=assert.rejects(old,{code:'STALE_PREPARATION'});
  const current=await session.prepare({...request,prompt:'newer edit'}); delayed.resolve(codec.encodePNG(pixels())); await stale;
  const result=await session.start(current.preparedId).result; assert.ok(result.candidateId);
});
test('new job invalidates a previously completed candidate before native confirmation',async()=>{
  const {session,request}=make(); const p=await session.prepare(request),r=await session.start(p.preparedId).result;
  const q=await session.prepare(request),j=session.start(q.preparedId); assert.throws(()=>session.accept(r.candidateId),{code:'STALE_CANDIDATE'}); await j.result;
});
test('cancelled key resolution cannot subsequently send credentials or image bytes',async()=>{
  const key=deferred(); let fetches=0;
  const p=G.createOpenAIProvider({enabled:true,getApiKey:()=>key.promise,fetchImpl:()=>{fetches++;throw Error('never');}});
  const controller=new AbortController(),running=p.run(providerRequest({signal:controller.signal})); controller.abort(); key.resolve('MOCK_SECRET');
  await assert.rejects(running,{code:'CANCELLED'}); assert.equal(fetches,0);
});
test('PNG pixel budget rejects decompression bomb before codec.decodePNG',async()=>{
  const bomb=codec.encodePNG(pixels()); bomb.writeUInt32BE(100000,16); bomb.writeUInt32BE(100000,20); let decoded=0;
  const {session,request}=make(fake(async()=>({png:bomb})),{codec:{...codec,decodePNG:b=>{decoded++;return codec.decodePNG(b);}}});
  const p=await session.prepare(request); await assert.rejects(session.start(p.preparedId).result,{code:'INVALID_OUTPUT'}); assert.equal(decoded,0);
});
test('detached disposal callback is safe and idempotent',()=>{
  const {session}=make(),close=session.dispose; close(); close(); assert.throws(()=>session.getOriginal(),{code:'SESSION_CLOSED'});
});
test('Alibaba long prompts fail locally instead of risking provider truncation',async()=>{
  const provider=G.createAlibabaProvider({enabled:true,workspaceId:'test',getApiKey:()=>{throw Error('no key read');},fetchImpl:()=>{throw Error('no upload');}});
  const {session,request}=make(provider);
  await assert.rejects(session.prepare({...request,task:'instruction-edit',prompt:'字'.repeat(401)}),{code:'INVALID_REQUEST'});
});
