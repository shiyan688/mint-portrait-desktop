'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),sharp=require('sharp'),{EventEmitter}=require('node:events');
const Text=require('../src/text-overlay.cjs'),Layers=require('../src/text-layers.cjs'),P=require('../src/project-document.cjs'),Core=require('../export-render-core.cjs'),{createExportRenderer}=require('../export-renderer.cjs');
let nativeCanvas;try{nativeCanvas=require('@napi-rs/canvas');}catch{}
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const layer=(extra={})=>({id:'text:1',enabled:true,recipe:{...Text.defaults(),text:'Mint 薄荷\n🧑🏽‍🚀 e\u0301',size:.18,rotation:17,outlineWidth:.08,shadow:true,...extra}});
const settings=extra=>({...structuredClone(P.DEFAULT_SETTINGS),...extra});
function picture(w=61,h=47){return{width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>i%4===3?[0,1,128,254,255][Math.floor(i/4)%5]:(i*29+Math.floor(i/4)*7)%256)};}
async function png(im=picture()){return new Uint8Array(await sharp(Buffer.from(im.data),{raw:{width:im.width,height:im.height,channels:4}}).png().toBuffer());}
function request(bytes,extra={}){return{requestId:'export-text:1',sourceRevision:'source:1',bytes,settings:settings({textLayers:[layer()]}),analysis:{landmarks:[],sourceRevision:'source:1'},mode:'original',format:'png',quality:1,...extra};}
function bind(req,rgba){const {width,height}=P.inspectImage(req.bytes,req.bytes[0]===137?'image/png':'image/jpeg'),plan=Core.sizePlan(width,height,req.mode,req.settings);return{version:1,requestId:req.requestId,sourceRevision:req.sourceRevision,sourceHash:sha(req.bytes),recipeHash:sha(Layers.canonicalRecipe(req.settings.textLayers)),mode:req.mode,width:plan.width,height:plan.height,rgba:rgba||Uint8Array.from({length:plan.width*plan.height*4},(_,i)=>i%4===3?[0,64,128,255][Math.floor(i/4)%4]:(i*31)%256)};}
async function run(req){const service=createExportRenderer();try{return await service.render(req);}finally{service.dispose();}}
function oracle(input,overlay){const out=input.data.slice();for(let i=0;i<out.length;i+=4){const a=BigInt(overlay.rgba[i+3]),b=BigInt(input.data[i+3]);if(a){const den=255n*a+(255n-a)*b;for(let c=0;c<3;c++){const num=255n*a*BigInt(overlay.rgba[i+c])+(255n-a)*b*BigInt(input.data[i+c]);out[i+c]=Number((2n*num+den)/(2n*den));}out[i+3]=Number((2n*den+255n)/510n);}if(out[i+3]===0)out[i]=out[i+1]=out[i+2]=0;}return{width:input.width,height:input.height,data:out};}
async function decoded(bytes){const d=await sharp(bytes).autoOrient().withIccProfile('srgb').toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});return{width:d.info.width,height:d.info.height,data:new Uint8ClampedArray(d.data)};}
test('main validates exact job/revision/encoded-source/recipe/mode/final-size binding and takes owned snapshots',async()=>{
 const r=request(await png());r.textOverlay=bind(r);const before=structuredClone(r),valid=Core.validateRequest(r);
 assert.notEqual(valid.textOverlay.rgba.buffer,r.textOverlay.rgba.buffer);assert.deepEqual(valid.textOverlay.rgba,r.textOverlay.rgba);
 r.bytes[0]=0;r.textOverlay.rgba[0]^=255;r.settings.textLayers[0].recipe.text='changed';assert.equal(valid.bytes[0],137);assert.equal(valid.textOverlay.rgba[0],before.textOverlay.rgba[0]);assert.equal(valid.settings.textLayers[0].recipe.text,before.settings.textLayers[0].recipe.text);
 for(const [key,value]of Object.entries({version:2,requestId:'stale-job',sourceRevision:'stale-source',sourceHash:'0'.repeat(64),recipeHash:'0'.repeat(64),mode:'working',width:60,height:46}))assert.throws(()=>Core.validateRequest({...before,textOverlay:{...before.textOverlay,[key]:value}}),/文字/);
 const sourceChanged=structuredClone(before);sourceChanged.bytes[sourceChanged.bytes.length-1]^=1;assert.throws(()=>Core.validateRequest(sourceChanged),/sourceHash/,'actual encoded bytes are hashed in main, not accepted from renderer');
 const recipeChanged=structuredClone(before);recipeChanged.settings.textLayers[0].recipe.text='other';assert.throws(()=>Core.validateRequest(recipeChanged),/recipeHash/);
});
test('missing/neutral extraneous overlays and every malformed envelope/buffer fail closed before worker creation',async()=>{
 const r=request(await png());r.textOverlay=bind(r);const noOverlay={...r};delete noOverlay.textOverlay;assert.throws(()=>Core.validateRequest(noOverlay),/缺少/);
 assert.throws(()=>Core.validateRequest({...r,settings:settings()}),/无活动文字/);assert.throws(()=>Core.validateRequest({...r,textOverlay:undefined}),/覆盖层/);
 const invalid=[null,{...r.textOverlay,unknown:1},{...r.textOverlay,rgba:new Uint8Array(3)},{...r.textOverlay,rgba:new Uint8ClampedArray(r.textOverlay.rgba)},{...r.textOverlay,rgba:new Uint8Array(new SharedArrayBuffer(r.textOverlay.rgba.length))},{...r.textOverlay,rgba:new(class extends Uint8Array{})(r.textOverlay.rgba)}];
 const symbol={...r.textOverlay};symbol[Symbol('x')]=true;invalid.push(symbol);const proto=Object.assign(Object.create({x:1}),r.textOverlay);invalid.push(proto);
 for(const key of Object.keys(r.textOverlay)){const missing={...r.textOverlay};delete missing[key];invalid.push(missing);}
 let reads=0;for(const key of ['rgba','sourceHash','width']){const getter={...r.textOverlay};Object.defineProperty(getter,key,{enumerable:true,get(){reads++;return r.textOverlay[key];}});invalid.push(getter);}
 const bytes=r.textOverlay.rgba.slice();Object.defineProperty(bytes,'length',{get(){reads++;return r.textOverlay.rgba.length;}});invalid.push({...r.textOverlay,rgba:bytes});
 for(const textOverlay of invalid)assert.throws(()=>Core.validateRequest({...r,textOverlay}));assert.equal(reads,0);
 let workers=0;class Fake{constructor(){workers++;}}const service=createExportRenderer({WorkerClass:Fake});try{await assert.rejects(service.render({...r,textOverlay:{...r.textOverlay,requestId:'stale'}}));assert.equal(workers,0);}finally{service.dispose();}
});
test('oversized metadata is rejected ahead of overlay-byte access; no-text request retains existing64MP plan',async()=>{
 const bytes=await png(picture(2,2)),view=new DataView(bytes.buffer);view.setUint32(16,4001);view.setUint32(20,4000);const r=request(bytes);let reads=0;const overlay={};Object.defineProperty(overlay,'rgba',{get(){reads++;throw Error('must not inspect overlay');}});
 assert.throws(()=>Core.validateRequest({...r,textOverlay:overlay}),/文字.*1600/);assert.equal(reads,0);const nontext={...r,settings:settings()};assert.equal(Core.validateRequest(nontext).plan.width,4001);
});
test('direct replay accepts only valid revision/recipe/final-size envelope and never silently skips active text',async()=>{
 const bytes=await png(),r=request(bytes);r.textOverlay=bind(r);const input=await decoded(bytes),before=input.data.slice(),expected=oracle(input,r.textOverlay);
 const actual=Core.processPixels(input,r.settings,r.analysis,r.textOverlay);for(let i=0;i<actual.data.length;i+=4)if(actual.data[i+3]===0)actual.data[i]=actual.data[i+1]=actual.data[i+2]=0;assert.deepEqual(actual,expected);assert.deepEqual(input.data,before);
 assert.throws(()=>Core.processPixels(input,r.settings,r.analysis),/缺少/);for(const key of ['sourceRevision','recipeHash','width'])assert.throws(()=>Core.processPixels(input,r.settings,r.analysis,{...r.textOverlay,[key]:key==='width'?1:'invalid'}));
});
test('real native PNG is exact independent source-over after tone/framing/padding and before privacy sanitization',async()=>{
 const bytes=await png(),before=bytes.slice(),s=settings({exposure:12,framing:{version:1,crop:{x:.1,y:.1,w:.8,h:.8},quarterTurns:1,flipX:true,flipY:false},canvasPadding:{version:1,top:.1,right:.2,bottom:.1,left:.05,color:'#588ac3',opacity:.4},textLayers:[layer()]}),r=request(bytes,{settings:s});r.textOverlay=bind(r);
 const base=Core.processPixels(await decoded(bytes),{...s,textLayers:[]},r.analysis),expected=oracle(base,r.textOverlay),out=await run(r),pixels=await sharp(out.bytes).ensureAlpha().raw().toBuffer();
 assert.deepEqual(pixels,Buffer.from(expected.data));assert.deepEqual([out.width,out.height],[expected.width,expected.height]);assert.equal(out.details.textLayers,1);assert.equal(out.details.sourceBytesUnchanged,true);assert.deepEqual(bytes,before);assert.equal(r.textOverlay.rgba.byteLength,r.textOverlay.width*r.textOverlay.height*4);
});
test('real native JPEG equals explicit white-flatten encoder of independent compositing oracle',async()=>{
 const bytes=await png(),r=request(bytes,{format:'jpeg'});r.textOverlay=bind(r);const expected=oracle(await decoded(bytes),r.textOverlay),encoded=await sharp(Buffer.from(expected.data),{raw:{width:expected.width,height:expected.height,channels:4}}).withIccProfile('srgb').flatten({background:'#ffffff'}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer(),actual=await run(r);
 assert.deepEqual(Buffer.from(actual.bytes),encoded);assert.equal((await sharp(actual.bytes).metadata()).hasAlpha,false);
});
test('worker transfer includes an independently owned overlay buffer, not the renderer input buffer',async()=>{
 const r=request(await png());r.textOverlay=bind(r);let captured;
 class Capture extends EventEmitter{constructor(path,options){super();captured=options;queueMicrotask(()=>this.emit('error',new Error('capture complete')));}terminate(){return Promise.resolve(0);}}
 const service=createExportRenderer({WorkerClass:Capture});try{await assert.rejects(service.render(r),/capture complete/);}finally{service.dispose();}
 assert.deepEqual(captured.transferList,[captured.workerData.bytes.buffer,captured.workerData.textOverlay.rgba.buffer]);assert.notEqual(captured.workerData.textOverlay.rgba.buffer,r.textOverlay.rgba.buffer);assert.ok(r.textOverlay.rgba.byteLength>0);
});
test('active-text cancellation terminates worker and a newly bound export can succeed',async()=>{
 const r=request(await png());r.textOverlay=bind(r);const service=createExportRenderer();try{const work=service.render(r);assert.equal(service.cancel('wrong-id'),false);assert.equal(service.cancel(r.requestId),true);await assert.rejects(work,e=>e.name==='AbortError');const next={...r,requestId:'next-export'};next.textOverlay=bind(next);const out=await service.render(next);assert.equal(out.details.textLayers,1);}finally{service.dispose();}
});
test('installed native Canvas raster replays shared font layouts in layer order through actual PNG/JPEG workers',{skip:!nativeCanvas},async()=>{
 const im=picture(320,240),bytes=await png(im),s=settings({textLayers:[layer({text:'Mint 薄荷',rotation:27}),{id:'second',enabled:true,recipe:{...Text.defaults(),text:'Mono 🧑🏽‍🚀',fontFamily:'mono',color:'#3ccac2',opacity:.65,y:.7,size:.16}}]}),r=request(bytes,{settings:s}),canvas=nativeCanvas.createCanvas(im.width,im.height),ctx=canvas.getContext('2d');
 for(const l of Layers.validate(s.textLayers))if(l.enabled&&Text.isActive(l.recipe))Text.render(ctx,im.width,im.height,l.recipe);
 const rgba=new Uint8Array(ctx.getImageData(0,0,im.width,im.height).data);assert.ok(rgba.some((n,i)=>i%4===3&&n>0));r.textOverlay=bind(r,rgba);
 const expected=oracle(await decoded(bytes),r.textOverlay),out=await run(r);assert.deepEqual(await sharp(out.bytes).ensureAlpha().raw().toBuffer(),Buffer.from(expected.data));assert.equal(out.details.textLayers,2);
 const jpg=await run({...r,format:'jpeg'}),expectedJpeg=await sharp(Buffer.from(expected.data),{raw:{width:im.width,height:im.height,channels:4}}).withIccProfile('srgb').flatten({background:'#ffffff'}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer();assert.deepEqual(Buffer.from(jpg.bytes),expectedJpeg);
});

test('original EXIF orientation and explicit working size bind text to final post-framing canvas',async()=>{
 const im=picture(19,13),bytes=new Uint8Array(await sharp(Buffer.from(im.data),{raw:{width:19,height:13,channels:4}}).flatten({background:'#ffffff'}).jpeg({quality:100}).withMetadata({orientation:6}).toBuffer()),r=request(bytes),before=sha(bytes);r.textOverlay=bind(r);const expected=oracle(await decoded(bytes),r.textOverlay),out=await run(r);assert.deepEqual([out.originalWidth,out.originalHeight],[13,19]);assert.deepEqual(await sharp(out.bytes).raw().toBuffer(),Buffer.from(expected.data));assert.equal(sha(bytes),before);assert.equal((await sharp(out.bytes).metadata()).orientation,undefined);
 const wide=await png(picture(5000,8)),working=request(wide,{mode:'working'});working.textOverlay=bind(working);const plan=Core.sizePlan(5000,8,'working',working.settings),raw=await sharp(wide).autoOrient().withIccProfile('srgb').toColourspace('srgb').ensureAlpha().resize(plan.processingWidth,plan.processingHeight,{fit:'fill',kernel:'lanczos3'}).raw().toBuffer(),expectedWorking=oracle({width:plan.width,height:plan.height,data:new Uint8ClampedArray(raw)},working.textOverlay),actual=await run(working);assert.equal(actual.width,4096);assert.equal(actual.scaled,true);assert.deepEqual(await sharp(actual.bytes).raw().toBuffer(),Buffer.from(expectedWorking.data));
});
test('request and source byte metadata accessors are refused without invocation',async()=>{
 const r=request(await png());r.textOverlay=bind(r);let reads=0;const input={...r};Object.defineProperty(input,'textOverlay',{enumerable:true,get(){reads++;return r.textOverlay;}});assert.throws(()=>Core.validateRequest(input));
 for(const key of ['buffer','length','byteLength','byteOffset']){const bytes=r.bytes.slice();Object.defineProperty(bytes,key,{get(){reads++;return key==='buffer'?new ArrayBuffer(1):1;}});assert.throws(()=>Core.validateRequest({...r,bytes}));}assert.equal(reads,0);
});
