'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),sharp=require('sharp'),{EventEmitter}=require('node:events');
const Size=require('../src/export-size.cjs'),Core=require('../export-render-core.cjs'),Project=require('../src/project-document.cjs'),Text=require('../src/text-overlay.cjs'),Layers=require('../src/text-layers.cjs'),{createExportRenderer}=require('../export-renderer.cjs');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const recipe=longEdge=>({version:1,mode:'long-edge',longEdge});
const settings=extra=>({...structuredClone(Project.DEFAULT_SETTINGS),...extra});
const request=(bytes,extra={})=>({requestId:'resize:1',sourceRevision:'source:1',bytes,settings:settings(),analysis:{landmarks:[],sourceRevision:'source:1'},mode:'original',format:'png',quality:1,...extra});
const picture=(width=43,height=29)=>({width,height,data:Uint8Array.from({length:width*height*4},(_,i)=>i%4===3?[0,32,128,255][Math.floor(i/4)%4]:(i*23+Math.floor(i/4)*17)%256)});
async function png(image=picture()){return new Uint8Array(await sharp(Buffer.from(image.data),{raw:{width:image.width,height:image.height,channels:4}}).png().toBuffer());}
async function solid(width,height){return new Uint8Array(await sharp({create:{width,height,channels:4,background:'#3274af'}}).png().toBuffer());}
async function run(r){const service=createExportRenderer();try{return await service.render(r);}finally{service.dispose();}}
async function decode(bytes){const d=await sharp(bytes).autoOrient().withIccProfile('srgb').toColourspace('srgb').ensureAlpha().raw({depth:'uchar'}).toBuffer({resolveWithObject:true});return{width:d.info.width,height:d.info.height,data:new Uint8ClampedArray(d.data)};}
function sanitize(data){const copy=Buffer.from(data);for(let i=0;i<copy.length;i+=4)if(copy[i+3]===0)copy[i]=copy[i+1]=copy[i+2]=0;return copy;}
async function resized(image,width,height){return sharp(Buffer.from(image.data),{raw:{width:image.width,height:image.height,channels:4,premultiplied:false}}).resize(width,height,{fit:'fill',kernel:'lanczos3',withoutEnlargement:true}).raw({depth:'uchar'}).toBuffer();}
function bind(r){const source=Project.inspectImage(r.bytes,r.bytes[0]===137?'image/png':'image/jpeg'),p=Core.sizePlan(source.width,source.height,r.mode,r.settings);return{version:1,requestId:r.requestId,sourceRevision:r.sourceRevision,sourceHash:hash(r.bytes),recipeHash:hash(Layers.canonicalRecipe(r.settings.textLayers)),mode:r.mode,width:p.width,height:p.height,rgba:Uint8Array.from({length:p.width*p.height*4},(_,i)=>i%4===3?[0,0,96,255][Math.floor(i/4)%4]:(i*31)%256)};}

test('real native PNG downsizes actual final composition; request/source bytes and recipe are immutable',async()=>{
 const bytes=await png(),r=request(bytes,{outputSize:recipe(17)}),before=hash(bytes),saved=structuredClone(r);
 const result=await run(r),p=Size.plan(43,29,recipe(17)),expected=sanitize(await resized(await decode(bytes),p.output.width,p.output.height));
 assert.deepEqual([result.width,result.height],[17,11]);assert.deepEqual([result.processingWidth,result.processingHeight,result.compositionWidth,result.compositionHeight],[43,29,43,29]);assert.equal(result.scaled,false);assert.equal(result.outputSizePlan.resized,true);
 assert.deepEqual(await sharp(result.bytes).ensureAlpha().raw().toBuffer(),expected);assert.match(result.details.resampling,/explicit-final-output-lanczos3/);assert.equal(result.details.codec,'sharp-0.35.5');assert.equal((await sharp(result.bytes).metadata()).hasProfile,true);
 assert.equal(hash(bytes),before);assert.deepEqual(r,saved);
 const snapshot=Core.validateRequest(r);r.outputSize.longEdge=1;r.bytes[0]=0;assert.equal(snapshot.outputSize.longEdge,17);assert.equal(snapshot.plan.outputSizePlan.recipe.longEdge,17);assert.equal(snapshot.bytes[0],137);
});

test('omitted, explicit unchanged and equal-longedge produce byte-exact neutral PNG/JPEG outputs',async()=>{
 const bytes=await png();for(const format of ['png','jpeg']){
  const r=request(bytes,{format}),plain=await run(r),neutral=await run({...r,outputSize:Size.defaults()}),equal=await run({...r,outputSize:recipe(43)});
  assert.deepEqual(neutral,plain);assert.deepEqual(equal.bytes,plain.bytes);assert.deepEqual(equal.details,plain.details);assert.equal(equal.outputSizePlan.resized,false);
 }
});

test('native exact longedge/half-up/onepixel outputs do not rely on Sharp auto aspect rounding',async()=>{
 for(const [w,h,n,ow,oh]of [[10,5,5,5,3],[5,10,5,3,5],[7,3,4,4,2],[1,16,1,1,1],[16,1,3,3,1],[31,31,7,7,7]]){
  const result=await run(request(await solid(w,h),{outputSize:recipe(n)})),meta=await sharp(result.bytes).metadata();
  assert.deepEqual([result.width,result.height,meta.width,meta.height],[ow,oh,ow,oh]);
 }
});

test('transparent colored pixels cannot tint resized edges; alpha-zero RGB is scrubbed after resizing',async()=>{
 const fixture=hidden=>{const width=48,height=12,data=new Uint8Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,a=x>=16&&x<32?255:x===15||x===32?100:0;data.set(a?[240,40,20,a]:[...hidden,0],i);}return{width,height,data};};
 const a=await run(request(await png(fixture([0,255,0])),{outputSize:recipe(13)})),b=await run(request(await png(fixture([0,0,255])),{outputSize:recipe(13)}));
 const actual=await sharp(a.bytes).ensureAlpha().raw().toBuffer();assert.deepEqual(actual,await sharp(b.bytes).ensureAlpha().raw().toBuffer());
 let zero=0,partial=0;for(let i=0;i<actual.length;i+=4){if(actual[i+3]===0){zero++;assert.deepEqual([...actual.subarray(i,i+4)],[0,0,0,0]);}else if(actual[i+3]<255){partial++;assert.ok(actual[i]>220&&actual[i+1]<55&&actual[i+2]<35,JSON.stringify([...actual.subarray(i,i+4)]));}}
 assert.ok(zero>0);assert.ok(partial>0);
});

test('JPEG is white-flattened only after actual resized and sanitized RGBA',async()=>{
 const bytes=await png(),r=request(bytes,{outputSize:recipe(17),format:'jpeg'}),output=await run(r),rgba=sanitize(await resized(await decode(bytes),17,11));
 const expected=await sharp(rgba,{raw:{width:17,height:11,channels:4}}).withIccProfile('srgb').flatten({background:'#ffffff'}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer();
 assert.deepEqual(Buffer.from(output.bytes),expected);assert.equal((await sharp(output.bytes).metadata()).hasAlpha,false);
 // Sharp performs flatten BEFORE resize within a single pipeline: prove that
 // erroneous one-pipeline implementation is observably different on this input.
 const decoded=await decode(bytes),wrong=await sharp(Buffer.from(decoded.data),{raw:{width:43,height:29,channels:4}}).withIccProfile('srgb').resize(17,11,{fit:'fill',kernel:'lanczos3'}).flatten({background:'#ffffff'}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer();
 assert.notDeepEqual(expected,wrong);
});

test('EXIF is oriented once before final output resize and stripped from exported file',async()=>{
 const im=picture(19,13),bytes=new Uint8Array(await sharp(Buffer.from(im.data),{raw:{width:19,height:13,channels:4}}).flatten({background:'#ffffff'}).jpeg({quality:100}).withMetadata({orientation:6}).toBuffer()),before=hash(bytes);
 const out=await run(request(bytes,{outputSize:recipe(9)})),meta=await sharp(out.bytes).metadata(),expected=sanitize(await resized(await decode(bytes),6,9));
 assert.deepEqual([out.originalWidth,out.originalHeight,out.processingWidth,out.processingHeight,out.width,out.height],[13,19,13,19,6,9]);assert.equal(meta.orientation,undefined);assert.equal(meta.exif,undefined);assert.equal(hash(bytes),before);assert.deepEqual(await sharp(out.bytes).ensureAlpha().raw().toBuffer(),expected);
});

test('effects, framing, padding and PRE-resize text overlay complete before native final reduction',async()=>{
 const bytes=await png(picture(61,47)),s=settings({exposure:14,framing:{version:1,crop:{x:.1,y:.1,w:.8,h:.8},quarterTurns:1,flipX:true,flipY:false},canvasPadding:{version:1,top:.1,right:.2,bottom:.3,left:.05,color:'#284f6a',opacity:.4},textLayers:[{id:'text:1',enabled:true,recipe:{...Text.defaults(),text:'Bound raster',size:.2}}]}),r=request(bytes,{settings:s,outputSize:recipe(23)});r.textOverlay=bind(r);
 const oldOverlay=hash(r.textOverlay.rgba),plan=Core.validateRequest(r).plan,composition=Core.processPixels(await decode(bytes),s,r.analysis,r.textOverlay),expected=sanitize(await resized(composition,plan.width,plan.height)),result=await run(r);
 assert.deepEqual([r.textOverlay.width,r.textOverlay.height],[plan.compositionWidth,plan.compositionHeight]);assert.notEqual(r.textOverlay.width,plan.width);assert.deepEqual(await sharp(result.bytes).ensureAlpha().raw().toBuffer(),expected);assert.equal(result.details.textLayers,1);assert.equal(result.framed,true);assert.equal(result.padded,true);assert.equal(hash(r.textOverlay.rgba),oldOverlay);
 const wrong={...r,textOverlay:{...r.textOverlay,width:plan.width,height:plan.height,rgba:new Uint8Array(plan.width*plan.height*4)}};assert.throws(()=>Core.validateRequest(wrong),/width|height/);
});

test('working source basis and final reduction are distinct operations and both run with text binding intact',async()=>{
 const bytes=await png(picture(5000,8)),r=request(bytes,{mode:'working',outputSize:recipe(1000),settings:settings({textLayers:[{id:'text',enabled:true,recipe:{...Text.defaults(),text:'X'}}]})});r.textOverlay=bind(r);
 const out=await run(r),p=Core.sizePlan(5000,8,'working',r.settings),working=await sharp(bytes).autoOrient().withIccProfile('srgb').toColourspace('srgb').ensureAlpha().resize(p.processingWidth,p.processingHeight,{fit:'fill',kernel:'lanczos3'}).raw().toBuffer();
 const composite=Core.processPixels({width:p.processingWidth,height:p.processingHeight,data:new Uint8ClampedArray(working)},r.settings,r.analysis,r.textOverlay),expected=sanitize(await resized(composite,1000,2));
 assert.deepEqual([out.originalWidth,out.processingWidth,out.compositionWidth,out.width,out.height],[5000,4096,4096,1000,2]);assert.equal(out.scaled,true);assert.match(out.details.resampling,/working-size.*final-output/);assert.deepEqual(await sharp(out.bytes).ensureAlpha().raw().toBuffer(),expected);
});

test('malformed/extra requests fail closed before worker creation, without invoking getters',async()=>{
 const r=request(await png()),bad=[null,undefined,{},recipe(44),recipe(0),recipe(16385),{...recipe(1),unknown:1}];let workers=0,reads=0;
 class None{constructor(){workers++;}}const service=createExportRenderer({WorkerClass:None});
 try{for(const outputSize of bad)await assert.rejects(service.render({...r,outputSize}));
  const nested=recipe(1);Object.defineProperty(nested,'longEdge',{enumerable:true,get(){reads++;return 1;}});await assert.rejects(service.render({...r,outputSize:nested}));
  const top={...r};Object.defineProperty(top,'outputSize',{enumerable:true,get(){reads++;return recipe(1);}});await assert.rejects(service.render(top));
  await assert.rejects(service.render({...r,outputSize:recipe(1),unknown:true}));assert.equal(workers,0);assert.equal(reads,0);
 }finally{service.dispose();}
});

test('tiny output cannot admit oversized real edge/source metadata, text/complex intermediates or hidden backing buffers',async()=>{
 let workers=0;class None{constructor(){workers++;}}const service=createExportRenderer({WorkerClass:None});
 try{
  await assert.rejects(service.render(request(await solid(16385,1),{outputSize:recipe(1)})),/6400/);
  const bytes=await png(picture(2,2)),large=bytes.slice();new DataView(large.buffer).setUint32(16,8001);new DataView(large.buffer).setUint32(20,8000);await assert.rejects(service.render(request(large,{outputSize:recipe(1)})),/6400/);
  const complex=bytes.slice();new DataView(complex.buffer).setUint32(16,4001);new DataView(complex.buffer).setUint32(20,4000);await assert.rejects(service.render(request(complex,{settings:settings({smooth:1}),outputSize:recipe(1)})),/1600/);
  await assert.rejects(service.render(request(complex,{settings:settings({textLayers:[{id:'text',enabled:true,recipe:{...Text.defaults(),text:'X'}}]}),outputSize:recipe(1)})),/文字.*1600/);
  const oversized=new Uint8Array(new ArrayBuffer(Core.LIMITS.sourceBytes+1),0,bytes.length);oversized.set(bytes);await assert.rejects(service.render(request(oversized,{outputSize:recipe(1)})),/缓冲区/);
  await assert.rejects(service.render(request(new Uint8Array(new SharedArrayBuffer(bytes.length)),{outputSize:recipe(1)})),/共享/);
  const text=request(bytes,{settings:settings({textLayers:[{id:'text',enabled:true,recipe:{...Text.defaults(),text:'X'}}]}),outputSize:recipe(1)});text.textOverlay=bind(text);text.textOverlay.rgba=new Uint8Array(new ArrayBuffer(64000001),0,16);await assert.rejects(service.render(text),/缓冲区/);
  assert.equal(workers,0);
 }finally{service.dispose();}
});

test('worker result output-size metadata and actual encoded dimensions are independently checked',async()=>{
 const bytes=await solid(8,4),r=request(bytes,{outputSize:recipe(4)}),valid=Core.validateRequest(r),correctBytes=await solid(4,2);
 for(const damage of [result=>{result.compositionWidth=1;},result=>{result.outputSizePlan.recipe.longEdge=1;},result=>{result.bytes=bytes;},result=>{delete result.outputSizePlan;}]){
  class Wrong extends EventEmitter{constructor(){super();const result={ok:true,bytes:correctBytes,...structuredClone(valid.plan),details:{}};damage(result);queueMicrotask(()=>this.emit('message',result));}terminate(){return Promise.resolve(0);}}
  const service=createExportRenderer({WorkerClass:Wrong});try{await assert.rejects(service.render(r),/校验失败/);}finally{service.dispose();}
 }
});

test('cancellation of final-output export terminates worker and the next resize job succeeds',async()=>{
 const service=createExportRenderer(),r=request(await solid(2000,2000),{outputSize:recipe(1000)}),before=hash(r.bytes);
 try{const running=service.render(r);assert.equal(service.cancel('other'),false);assert.equal(service.cancel(r.requestId),true);await assert.rejects(running,error=>error.name==='AbortError');assert.equal(service.isBusy(),false);assert.equal(hash(r.bytes),before);
  const next=await service.render(request(await solid(10,5),{requestId:'resize:2',outputSize:recipe(5)}));assert.deepEqual([next.width,next.height],[5,3]);
 }finally{service.dispose();}
});
