'use strict';
// Synthetic-only qualification. Real Sharp worker/PNG codec + real UMD pixel worker;
// browser scheduling uses a DOM/Canvas double, not an Electron or Windows UI claim.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{createRequire}=require('node:module');
const sharp=require(process.env.MINT_SHARP_MODULE||'sharp');
let NativeCanvas;try{NativeCanvas=require(process.env.MINT_NATIVE_CANVAS_MODULE||'@napi-rs/canvas');}catch(error){if(process.env.MINT_NATIVE_CANVAS_MODULE)throw error;}
const Core=require('../export-render-core.cjs'),Project=require('../src/project-document.cjs'),Overlay=require('../src/image-overlay.cjs'),Images=require('../src/image-layers.cjs'),Assets=require('../src/image-assets.cjs'),Geometry=require('../src/geometry.cjs'),Straight=require('../src/straighten.cjs'),Padding=require('../src/canvas-padding.cjs'),Local=require('../src/local-adjustments.cjs'),Text=require('../src/text-overlay.cjs'),TextLayers=require('../src/text-layers.cjs'),PaintLayers=require('../src/paint-layers.cjs'),Redactions=require('../src/redaction-layers.cjs'),{createExportRenderer}=require('../export-renderer.cjs');
const rev='image-independent:source',analysis={sourceRevision:rev,landmarks:[]},sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const settings=extra=>({...structuredClone(Project.DEFAULT_SETTINGS),...extra});
const layer=(asset,recipe={},extra={})=>({id:'image:1',name:'Synthetic overlay',enabled:true,assetId:asset.id,recipe:{...Overlay.defaults(),...recipe},...extra});
// Independent encoder and dimension-bound SHA oracle: neither shared asset codec
// nor compositor is used to construct the canonical records tested at the boundary.
function asset(width=1,height=1,rgba=[211,41,107,128]){
 const data=Uint8Array.from({length:width*height*4},(_,i)=>rgba[i%rgba.length]);
 const dim=Buffer.alloc(8);dim.writeUInt32LE(width,0);dim.writeUInt32LE(height,4);
 return{id:'rgba-'+sha(Buffer.concat([Buffer.from('mint-rgba-asset-v1\0','ascii'),dim,Buffer.from(data)])),version:1,width,height,data:Buffer.from(data).toString('base64')};
}
function picture(width=48,height=32){const data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;data.set([(x*29+y*7)%256,(x*3+y*41)%256,(x*19+y*23)%256,[0,1,37,97,128,254,255][(x+3*y)%7]],i);}return{width,height,data};}
const request=(bytes,extra={})=>({requestId:'image-independent:export',sourceRevision:rev,bytes,settings:settings(),analysis,mode:'original',format:'png',quality:1,...extra});
async function png(im=picture()){return new Uint8Array(await sharp(Buffer.from(im.data),{raw:{width:im.width,height:im.height,channels:4}}).png().toBuffer());}
async function decoded(bytes){const d=await sharp(bytes).autoOrient().withIccProfile('srgb').toColourspace('srgb').ensureAlpha().raw({depth:'uchar'}).toBuffer({resolveWithObject:true});return{width:d.info.width,height:d.info.height,data:new Uint8ClampedArray(d.data)};}
async function outputPixels(bytes){return sharp(bytes).ensureAlpha().raw({depth:'uchar'}).toBuffer();}
async function render(r,options){const service=createExportRenderer(options);try{return await service.render(r);}finally{service.dispose();}}
function scrub(data){const out=Buffer.from(data);for(let i=0;i<out.length;i+=4)if(!out[i+3])out[i]=out[i+1]=out[i+2]=0;return out;}
function projectAsset(a){return{version:a.version,width:a.width,height:a.height,data:a.data};}
function stagedImages(im,layers,assets){let out=im;for(const l of layers)if(l.enabled&&l.recipe.opacity)out=Overlay.createProfile('desktop').apply(out,projectAsset(assets.find(a=>a.id===l.assetId)),l.recipe);return out;}
function sourceOverInteger(input,rgba,rect,numerator=1,denominator=1){
 const data=input.data.slice(),q=BigInt(denominator),sa=BigInt(rgba[3])*BigInt(numerator),round=(n,d)=>Number((2n*n+d)/(2n*d));
 for(let y=rect.y;y<rect.y+rect.height;y++)for(let x=rect.x;x<rect.x+rect.width;x++){
  const i=(y*input.width+x)*4,da=BigInt(input.data[i+3]),remaining=255n*q-sa,den=255n*sa+remaining*da;
  if(!sa||!den)continue;
  const alpha=round(den,255n*q);if(!alpha)continue;
  for(let c=0;c<3;c++)data[i+c]=round(255n*sa*BigInt(rgba[c])+remaining*da*BigInt(input.data[i+c]),den);
  data[i+3]=alpha;
 }
 return{width:input.width,height:input.height,data};
}
function runPixelWorker(im,s,assets=[],extra={}){
 let response;const c=vm.createContext({raw:Array.from(im.data),w:im.width,h:im.height,json:JSON.stringify(s),facts:JSON.stringify(analysis),assets:JSON.stringify(assets),retained:extra.retainedBytes,self:{postMessage:r=>response=r}});
 c.importScripts=(...names)=>{for(const name of names)vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),c,{filename:name});};
 vm.runInContext(fs.readFileSync(require.resolve('../src/pixel-worker.js'),'utf8'),c,{filename:'pixel-worker.js'});
 vm.runInContext('self.onmessage({data:{width:w,height:h,buffer:Uint8ClampedArray.from(raw).buffer,settings:JSON.parse(json),analysis:JSON.parse(facts),imageAssets:JSON.parse(assets),retainedBytes:retained}})',c);
 if(response.error)throw Error(response.error);
 return{...JSON.parse(JSON.stringify({...response,buffer:undefined})),data:new Uint8ClampedArray(response.buffer)};
}
const raster=r=>({width:r.width,height:r.height,data:r.data});
const textRaster=r=>({width:r.width,height:r.height,rgba:r.rgba});
function browserHarness(){
 const workers=[];let creates=0;
 class Canvas{constructor(width=48,height=32){this.width=width;this.height=height;this.reads=0;}getContext(){return{getImageData:()=>{this.reads++;return picture(this.width,this.height);},putImageData:im=>{this.pixels=im.data.slice();}};}}
 class Worker{constructor(){workers.push(this);}postMessage(value){this.input=structuredClone(value);}terminate(){this.terminated=true;}finish(damage){const i=this.input,result=runPixelWorker({width:i.width,height:i.height,data:new Uint8ClampedArray(i.buffer)},i.settings,i.imageAssets,{retainedBytes:i.retainedBytes}),data=local({...result,data:undefined});data.buffer=result.data.buffer;damage?.(data);this.onmessage({data});}}
 const c=vm.createContext({console,URL,DOMException,structuredClone,queueMicrotask,AbortController,setTimeout,Worker,Blob,ImageData:class{constructor(data,width,height){Object.assign(this,{data,width,height});}},document:{createElement:()=>{creates++;return new Canvas();}}});
 for(const name of ['geometry','straighten','canvas-padding','sharpness','image-overlay','image-layers'])vm.runInContext(fs.readFileSync(require.resolve('../src/'+name+'.cjs'),'utf8'),c);
 const source=fs.readFileSync(require.resolve('../src/pipeline.js'),'utf8').replace(/^import .*;$/m,'').replaceAll('import.meta.url',JSON.stringify('mint://app/src/pipeline.js')).replace(/^export /gm,'');
 vm.runInContext(source+'\nglobalThis.api={render,preflightRender,cancelRenders,lightBalanceInputSettings};',c);
 function local(value){c.json=JSON.stringify(value);return vm.runInContext('JSON.parse(json)',c);}
 return{api:c.api,Canvas,workers,local,c,creates:()=>creates};
}
function instrumentedCore(override){const filename=require.resolve('../export-render-core.cjs'),nativeRequire=createRequire(filename),module={exports:{}};vm.runInThisContext('(function(module,require,Uint8Array){'+fs.readFileSync(filename,'utf8')+'\n})',{filename})(module,nativeRequire,override);return module.exports;}

test('independent dimension-bound IDs match the asset codec and dimensions cannot be relabelled',async()=>{
 const a=asset(2,1,[1,7,31,0,13,101,255,128]),codec=Assets.createCodec({overlay:Overlay});assert.deepEqual(await codec.verify(a),a);assert.notEqual(a.id,asset(1,2,[1,7,31,0,13,101,255,128]).id);await assert.rejects(codec.verify({...a,width:1,height:2}),/identity/);
});

test('real PNG source-over matches an independent integer oracle at aligned opaque and partial-alpha coverage',async()=>{
 for(const color of [[211,41,107,128],[13,201,87,255],[241,90,1,1]])for(const [n,d]of [[1,1],[1,2]]){
  const bytes=await png(picture(16,12)),a=asset(1,1,color),s=settings({imageLayers:[layer(a,{size:2/3,opacity:n/d})]}),before=sha(bytes),input=await decoded(bytes),expected=sourceOverInteger(input,color,{x:4,y:2,width:8,height:8},n,d),out=await render(request(bytes,{settings:s,imageAssets:[a]}));
  assert.deepEqual(await outputPixels(out.bytes),scrub(expected.data));assert.equal(out.imageLayered,true);assert.equal(out.imageLayerKey,Images.canonicalRecipe(s.imageLayers));assert.equal(out.details.imageOverlay,'premultiplied-srgb-mip-bilinear-edge4x4');assert.equal(out.details.imageLayerKey,out.imageLayerKey);assert.equal(sha(bytes),before);
 }
});

test('actual PNG, native replay and actual VM pixel worker equal staged transformed/mipped layers without modifying originals',async()=>{
 const bytes=await png(picture(113,79)),input=await decoded(bytes),a=asset(127,63,[240,7,23,255,17,230,41,32,250,0,240,0]),b=asset(2,3,[5,23,249,137,231,220,1,255]),layers=[layer(a,{size:.16,x:.55,y:.43,rotation:31,flipX:true}),layer(b,{size:.67,x:.65,y:.43,rotation:-70,opacity:.63,flipY:true},{id:'image:2'})],s=settings({imageLayers:layers}),original=structuredClone({bytes,input,assets:[a,b],s});
 const expected=stagedImages(input,layers,[a,b]);assert.ok(Overlay.createProfile('desktop').layout(input.width,input.height,projectAsset(a),layers[0].recipe).mipLevels>0);assert.notDeepEqual(expected.data,input.data);
 assert.deepEqual(Core.processPixels(input,s,analysis,undefined,{imageAssets:[a,b]}),expected);
 const worker=runPixelWorker(input,s,[a,b]);assert.deepEqual(raster(worker),expected);assert.equal(worker.imageLayerKey,Images.canonicalRecipe(layers));assert.equal(worker.imageLayered,true);
 const native=await render(request(bytes,{settings:s,imageAssets:[a,b]}));assert.deepEqual(await outputPixels(native.bytes),scrub(expected.data));assert.deepEqual({bytes,input,assets:[a,b],s},original);
 const reverse=stagedImages(input,[...layers].reverse(),[a,b]);assert.notDeepEqual(reverse.data,expected.data,'synthetic overlap must make layer order observable');
});

test('disabled and zero-opacity layers preserve exact legacy PNG/JPEG bytes and metadata, and native/VM pixels',async()=>{
 const bytes=await png(picture(29,17)),input=await decoded(bytes),a=asset();
 for(const format of ['png','jpeg']){const baseline=await render(request(bytes,{format}));for(const l of [layer(a,{}, {enabled:false}),layer(a,{opacity:0})]){const s=settings({imageLayers:[l]}),out=await render(request(bytes,{settings:s,imageAssets:[a],format}));assert.deepEqual(out,baseline);assert.deepEqual(Core.processPixels(input,s,analysis,undefined,{imageAssets:[a]}),input);const w=runPixelWorker(input,s,[a]);assert.deepEqual(raster(w),input);assert.equal(Object.hasOwn(w,'imageLayered'),false);assert.equal(Object.hasOwn(w,'imageLayerKey'),false);}}
 assert.equal(Core.sizePlan(8000,8000,'original',settings({imageLayers:[layer(a,{opacity:0})]}),undefined,{imageAssets:[a]}).width,8000);
});

test('native pipeline enforces tone→framing→straighten→padding→image→text→paint→redaction→final downsize',async()=>{
 const bytes=await png(picture(160,120)),a=asset(2,1,[211,19,84,224,11,205,51,128]),s=settings({exposure:9,contrast:4,framing:{...Geometry.defaults(),crop:{x:.1,y:.1,w:.8,h:.7},quarterTurns:1,flipX:true},straighten:{version:1,angle:13,mode:'expand'},canvasPadding:{...Padding.defaults(),left:.2,top:.1,color:'#173c64',opacity:.6},imageLayers:[layer(a,{size:1.2,rotation:27,opacity:.7})],textLayers:[{id:'text:1',enabled:true,recipe:{...Text.defaults(),text:'Synthetic X',size:.2}}]});
 s.paintLayers={version:1,sourceRevision:rev,geometryKey:Redactions.geometryKey(s),layers:[{id:'paint:1',name:'Synthetic paint',enabled:true,selection:null,recipe:{version:1,strokes:[{mode:'paint',color:'#123456',width:.07,opacity:1,points:[{x:.2,y:.3},{x:.7,y:.3}]}]}}]};
 s.redactions={version:1,sourceRevision:rev,geometryKey:Redactions.geometryKey(s),layers:[{id:'redact:1',name:'Privacy cover',enabled:true,selection:null,recipe:{version:1,mode:'cover',color:'#714b8c',blockSize:.1,strokes:[{radius:.1,points:[{x:.15,y:.35},{x:.9,y:.35}]}]}}]};
 const r=request(bytes,{settings:s,imageAssets:[a],outputSize:{version:1,mode:'long-edge',longEdge:61}}),plan=Core.sizePlan(160,120,'original',s,r.outputSize,{sourceRevision:rev,imageAssets:[a]}),w=plan.compositionWidth,h=plan.compositionHeight;
 const bind=(paint,recipeHash)=>{const rgba=new Uint8Array(w*h*4);for(let y=Math.floor(h*.25);y<Math.floor(h*.65);y++)for(let x=Math.floor(w*.2);x<Math.floor(w*.75);x++)if((x+y)%3!==0)rgba.set(paint?[17,203,231,196]:[249,23,193,240],(y*w+x)*4);return{version:1,requestId:r.requestId,sourceRevision:rev,sourceHash:sha(bytes),recipeHash,mode:'original',width:w,height:h,rgba};};
 r.textOverlay=bind(false,sha(TextLayers.canonicalRecipe(s.textLayers)));r.paintOverlay=bind(true,sha(PaintLayers.canonicalRecipe(s.paintLayers)));
 let base=Local.tone(await decoded(bytes),s);base=Geometry.apply(base,s.framing);base=Straight.apply(base,s.straighten);base=Padding.apply(base,s.canvasPadding);let expected=stagedImages(base,s.imageLayers,[a]);const imageBeforeText=expected;expected=TextLayers.composite(expected,textRaster(r.textOverlay));expected=TextLayers.composite(expected,textRaster(r.paintOverlay));const beforeRedaction=expected;expected=Redactions.apply(expected,s.redactions,{sourceRevision:rev,settings:s,sourceSize:{width:160,height:120}});
 assert.notDeepEqual(imageBeforeText.data,TextLayers.composite(base,textRaster(r.textOverlay)).data);assert.notDeepEqual(beforeRedaction.data,expected.data);assert.notDeepEqual(stagedImages(TextLayers.composite(base,textRaster(r.textOverlay)),s.imageLayers,[a]).data,TextLayers.composite(imageBeforeText,textRaster(r.textOverlay)).data,'order must be observable');
 const native=Core.processPixels(await decoded(bytes),s,analysis,r.textOverlay,{imageAssets:[a],paintOverlay:r.paintOverlay});assert.deepEqual(native,expected);
 const out=await render(r),small=await sharp(Buffer.from(expected.data),{raw:{width:w,height:h,channels:4,premultiplied:false}}).resize(out.width,out.height,{fit:'fill',kernel:'lanczos3',withoutEnlargement:true}).raw().toBuffer();assert.deepEqual(await outputPixels(out.bytes),scrub(small));assert.equal(out.straightened,true);assert.equal(out.padded,true);assert.equal(out.imageLayered,true);assert.equal(out.details.textLayers,1);assert.equal(out.details.paintLayers,1);
 const noText={...s,textLayers:[],paintLayers:null};let workerExpected=Redactions.apply(imageBeforeText,s.redactions,{sourceRevision:rev,settings:noText,sourceSize:{width:160,height:120}});assert.deepEqual(raster(runPixelWorker(await decoded(bytes),noText,[a])),workerExpected);
});

test('installed NativeCanvas glyph raster lands after image overlay in actual PNG output',{skip:!NativeCanvas&&'Set MINT_NATIVE_CANVAS_MODULE or install the approved @napi-rs/canvas dependency'},async()=>{
 const bytes=await png(picture(192,128)),a=asset(1,1,[28,210,93,255]),s=settings({imageLayers:[layer(a,{size:1.4})],textLayers:[{id:'glyph',enabled:true,recipe:{...Text.defaults(),text:'Mint 薄荷',size:.25,color:'#ef275b',rotation:17}}]}),canvas=NativeCanvas.createCanvas(192,128),ctx=canvas.getContext('2d');
 Text.render(ctx,192,128,s.textLayers[0].recipe);const rgba=new Uint8Array(ctx.getImageData(0,0,192,128).data);assert.ok(rgba.some((n,i)=>i%4===3&&n>0));
 const r=request(bytes,{settings:s,imageAssets:[a]});r.textOverlay={version:1,requestId:r.requestId,sourceRevision:rev,sourceHash:sha(bytes),recipeHash:sha(TextLayers.canonicalRecipe(s.textLayers)),mode:'original',width:192,height:128,rgba};const expected=TextLayers.composite(stagedImages(await decoded(bytes),s.imageLayers,[a]),textRaster(r.textOverlay));assert.deepEqual(await outputPixels((await render(r)).bytes),scrub(expected.data));
});

test('hidden source/asset RGB cannot leak into visible pixels and actual PNG export sanitizes every zero-alpha pixel',async()=>{
 const a=asset(2,2,[240,0,255,0,21,201,91,193]),b=asset(2,2,[0,255,0,0,21,201,91,193]),im=picture(48,32),im2=structuredClone(im);for(let i=0;i<im.data.length;i+=4)if(!im.data[i+3]){im.data.set([255,0,255,0],i);im2.data.set([0,255,0,0],i);}
 const sA=settings({imageLayers:[layer(a,{size:.7,rotation:33})]}),sB=settings({imageLayers:[layer(b,{size:.7,rotation:33})]}),before=structuredClone({im,im2,a,b});const outA=await render(request(await png(im),{settings:sA,imageAssets:[a]})),outB=await render(request(await png(im2),{settings:sB,imageAssets:[b]}));assert.deepEqual(outA.bytes,outB.bytes);const pixels=await outputPixels(outA.bytes);assert.ok(pixels.some((v,i)=>i%4===3&&v===0));for(let i=0;i<pixels.length;i+=4)if(!pixels[i+3])assert.deepEqual(pixels.subarray(i,i+4),Buffer.alloc(4));assert.deepEqual({im,im2,a,b},before);
});

test('native boundary rejects missing/extra/duplicate/malformed/wrong-hash assets and unsafe getters before worker creation',async()=>{
 const bytes=await png(),a=asset(),b=asset(1,1,[33,44,55,255]),r=request(bytes,{settings:settings({imageLayers:[layer(a)]}),imageAssets:[a]});let workers=0,reads=0;class Never{constructor(){workers++;}}
 const bad=[undefined,null,[],[a,b],[a,a],[{...a,id:'rgba-'+'0'.repeat(64)}],[{...a,data:Buffer.from([1,2,3,4]).toString('base64')}],[{...a,data:a.data.slice(0,-1)+'A'}],[{...a,width:2}],[{...a,url:'file:///private.png'}],[Object.assign(Object.create({id:a.id}),a)],Array(1)];
 for(const key of ['id','data','width']){const getter={...a};Object.defineProperty(getter,key,{enumerable:true,get(){reads++;return a[key];}});bad.push([getter]);}
 const extended=[a];extended.extra=1;bad.push(extended);const symbol=[a];symbol[Symbol('x')]=true;bad.push(symbol);
 const service=createExportRenderer({WorkerClass:Never});try{for(const imageAssets of bad)await assert.rejects(service.render({...r,imageAssets}));const missing={...r};delete missing.imageAssets;await assert.rejects(service.render(missing));const top={...r};Object.defineProperty(top,'imageAssets',{enumerable:true,get(){reads++;return[a];}});await assert.rejects(service.render(top));for(const change of [{enabled:false},{recipe:{...Overlay.defaults(),opacity:0}}])await assert.rejects(service.render({...r,settings:settings({imageLayers:[{...layer(a),...change}]}),imageAssets:[]}));assert.equal(workers,0);assert.equal(reads,0);}finally{service.dispose();}
});

test('asset payloads and settings are immutable snapshots across validation and worker transfer',async()=>{
 const bytes=await png(),a=asset(),r=request(bytes,{settings:settings({imageLayers:[layer(a)]}),imageAssets:[a]}),original=structuredClone(r),valid=Core.validateRequest(r);r.imageAssets[0].data='AAAAAAAA';r.imageAssets.length=0;r.settings.imageLayers[0].recipe.x=.1;r.bytes[0]=0;assert.deepEqual(valid.imageAssets,original.imageAssets);assert.deepEqual(valid.settings.imageLayers,original.settings.imageLayers);assert.equal(valid.bytes[0],137);assert.ok(Object.isFrozen(valid.imageAssets)&&Object.isFrozen(valid.imageAssets[0]));
 let captured;class Capture extends EventEmitter{constructor(filename,options){super();captured=options;queueMicrotask(()=>this.emit('error',Error('captured')));}terminate(){return Promise.resolve(0);}}await assert.rejects(render(original,{WorkerClass:Capture}),/captured/);assert.deepEqual(captured.workerData.imageAssets,original.imageAssets);assert.notEqual(captured.workerData.imageAssets,original.imageAssets);assert.deepEqual(captured.transferList,[captured.workerData.bytes.buffer]);assert.equal(original.bytes[0],137);
});

test('tiny final output cannot bypass source/edge/final image-overlay caps or combined retained budget before source copy',async()=>{
 const a=asset(),small={version:1,mode:'long-edge',longEdge:1},bytes=await png(picture(2,2)),s=settings({imageLayers:[layer(a)]});let copies=0,workers=0;const Tracked=new Proxy(Uint8Array,{construct(target,args){if(ArrayBuffer.isView(args[0]))copies++;return Reflect.construct(target,args,target);}}),core=instrumentedCore(Tracked);class Never{constructor(){workers++;}}
 const cases=[[8001,8000,s],[16385,1,s],[4097,4096,s],[3900,3900,{...s,canvasPadding:{...Padding.defaults(),left:.1,right:.1}}],[4096,4096,{...s,framing:Geometry.defaults(),straighten:{version:1,angle:13,mode:'expand'}}]];
 const service=createExportRenderer({WorkerClass:Never});try{for(const [w,h,config]of cases){const source=bytes.slice();new DataView(source.buffer).setUint32(16,w);new DataView(source.buffer).setUint32(20,h);const r=request(source,{settings:config,imageAssets:[a],outputSize:small});assert.throws(()=>core.validateRequest(r));await assert.rejects(service.render(r));}assert.equal(copies,0);assert.equal(workers,0);}finally{service.dispose();}
 assert.throws(()=>Core.sizePlan(48,32,'original',s,small,{imageAssets:[a],retainedBytes:512*1024*1024}),/512/);const im=picture(4,4),backing=new ArrayBuffer(32*1024*1024),view=new Uint8ClampedArray(backing,100,im.data.length);view.set(im.data);assert.throws(()=>Core.processPixels({...im,data:view},s,analysis,undefined,{imageAssets:[a],retainedBytes:500*1024*1024}),/512/);assert.deepEqual(view,im.data);
 assert.equal(Core.sizePlan(8000,8000,'working',s,small,{imageAssets:[a]}).processingWidth,4000);
});

test('direct and native cancellation do not mutate input or publish stale bytes, and the next image export succeeds',async()=>{
 const im=picture(320,240),a=asset(32,32),s=settings({imageLayers:[layer(a,{size:1.4,rotation:17})]}),before=im.data.slice();for(const stop of [0,3,20,50]){let calls=0;assert.throws(()=>Core.processPixels(im,s,analysis,undefined,{imageAssets:[a],shouldCancel:()=>calls++>=stop}),e=>e.name==='AbortError');assert.deepEqual(im.data,before);}
 const bytes=await png(im),r=request(bytes,{settings:s,imageAssets:[a]}),service=createExportRenderer();try{const pending=service.render(r);assert.equal(service.cancel('foreign-job'),false);assert.equal(service.cancel(r.requestId),true);await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(service.isBusy(),false);const next=await service.render({...r,requestId:'image-independent:next'});assert.equal(next.imageLayered,true);}finally{service.dispose();}
});

test('forged active or neutral image provenance cannot pass native worker result validation',async()=>{
 const bytes=await png(picture(8,8)),a=asset(),active=request(bytes,{settings:settings({imageLayers:[layer(a)]}),imageAssets:[a]});
 for(const r of [active,request(bytes)]){
  const v=Core.validateRequest(r);const damages=r===active?[x=>delete x.imageLayered,x=>x.imageLayered=false,x=>delete x.imageLayerKey,x=>x.imageLayerKey='[]',x=>delete x.details.imageOverlay,x=>x.details.imageOverlay='fake',x=>x.details.imageLayerKey='stale']:[x=>x.imageLayered=false,x=>x.imageLayerKey='[]',x=>x.details.imageOverlay='none',x=>x.details.imageLayerKey='[]'];
  for(const damage of damages){class Forged extends EventEmitter{constructor(){super();const result={ok:true,bytes:bytes.slice(),...structuredClone(v.plan),details:structuredClone(Core.resamplingDetails(v.plan))};damage(result);queueMicrotask(()=>this.emit('message',result));}terminate(){return Promise.resolve(0);}}await assert.rejects(render(r,{WorkerClass:Forged}),/校验失败/);}
 }
});

test('browser preflight snapshots image assets without readback; real pixel-worker output matches native replay',async()=>{
 const h=browserHarness(),canvas=new h.Canvas(),a=asset(),s=h.local(settings({imageLayers:[layer(a,{rotation:17})]})),options=h.local({imageAssets:[a]}),p=h.api.preflightRender(canvas,s,h.local(analysis),options);assert.equal(canvas.reads,0);assert.equal(h.workers.length,0);assert.equal(h.creates(),0);assert.equal(p.imageOverlayMetadata.imageLayered,true);assert.ok(p.managedGeometryBytes>0);
 const pending=h.api.render(canvas,s,h.local(analysis),options);s.imageLayers[0].recipe.x=.1;options.imageAssets[0].data='AAAAAAAA';const i=h.workers[0].input;h.workers[0].finish();const output=await pending,expected=Core.processPixels(picture(),i.settings,analysis,undefined,{imageAssets:i.imageAssets});assert.deepEqual(Buffer.from(output.pixels),Buffer.from(expected.data));assert.equal(i.imageAssets[0].data,a.data);assert.equal(i.settings.imageLayers[0].recipe.x,.5);
});

test('browser forged/stale image envelopes are rejected before Canvas allocation',async()=>{
 const a=asset();for(const active of [false,true])for(const damage of active?[x=>delete x.imageLayered,x=>x.imageLayered=false,x=>delete x.imageLayerKey,x=>x.imageLayerKey='stale']:[x=>x.imageLayered=false,x=>x.imageLayerKey='[]']){const h=browserHarness(),s=settings({imageLayers:active?[layer(a)]:[]}),p=h.api.render(new h.Canvas(),h.local(s),h.local(analysis),h.local({imageAssets:active?[a]:[]}));h.workers[0].finish(damage);await assert.rejects(p,/贴图/);assert.equal(h.creates(),0);}
});

test('browser overlay jobs serialize, queued cancellation avoids readback and late publication cannot replace the next render',async()=>{
 const h=browserHarness(),a=asset(),s=h.local(settings({imageLayers:[layer(a)]})),opts=h.local({imageAssets:[a]}),canvas=new h.Canvas(),one=h.api.render(canvas,s,h.local(analysis),opts),abort=new AbortController(),two=h.api.render(canvas,s,h.local(analysis),{...opts,signal:abort.signal}).catch(e=>e.name);assert.equal(h.workers.length,1);abort.abort();assert.equal(await two,'AbortError');assert.equal(canvas.reads,1);h.workers[0].finish();await one;
 const running=new AbortController(),cancelled=h.api.render(canvas,s,h.local(analysis),{...opts,signal:running.signal}).catch(e=>e.name);running.abort();assert.equal(await cancelled,'AbortError');const next=h.api.render(canvas,h.local(settings()),h.local(analysis));h.workers[1].finish();assert.equal(h.creates(),1);h.workers[2].finish();assert.equal((await next).width,canvas.width);assert.equal(h.creates(),2);
});

test('browser source/manual/white-balance inputs omit image overlays while memory overflow rejects before readback',async()=>{
 const h=browserHarness(),a=asset(),s=h.local(settings({imageLayers:[layer(a)]})),opts=h.local({imageAssets:[a]});for(const option of [{sourceView:true},{manualEditing:true}]){const p=h.api.render(new h.Canvas(),s,h.local(analysis),{...opts,...option});assert.equal(h.workers.at(-1).input.settings.imageLayers.length,0);h.workers.at(-1).finish();await p;}
 assert.equal(h.api.lightBalanceInputSettings(s).imageLayers.length,0);const canvas=new h.Canvas();await assert.rejects(h.api.render(canvas,s,h.local(analysis),{...opts,retainedBytes:512*1024*1024}),/512/);assert.equal(canvas.reads,0);
});

test('explicit working reduction and final downsize remain separate image-overlay coordinate stages',async()=>{
 const bytes=await png(picture(5000,180)),a=asset(3,2,[243,12,81,255,7,210,132,67]),s=settings({imageLayers:[layer(a,{size:1.2,x:.73,y:.55,rotation:19,flipX:true})]}),r=request(bytes,{settings:s,imageAssets:[a],mode:'working',outputSize:{version:1,mode:'long-edge',longEdge:1000}}),out=await render(r);
 assert.equal(out.originalWidth,5000);assert.equal(out.processingWidth,4096);assert.equal(out.compositionWidth,4096);assert.equal(out.width,1000);assert.equal(out.scaled,true);assert.match(out.details.resampling,/working-size.*final-output/);
 const raw=await sharp(bytes).autoOrient().withIccProfile('srgb').toColourspace('srgb').ensureAlpha().resize(out.processingWidth,out.processingHeight,{fit:'fill',kernel:'lanczos3'}).raw().toBuffer(),base={width:out.processingWidth,height:out.processingHeight,data:new Uint8ClampedArray(raw)},composed=stagedImages(base,s.imageLayers,[a]),expected=await sharp(Buffer.from(composed.data),{raw:{width:composed.width,height:composed.height,channels:4,premultiplied:false}}).resize(out.width,out.height,{fit:'fill',kernel:'lanczos3',withoutEnlargement:true}).raw().toBuffer();
 assert.deepEqual(await outputPixels(out.bytes),scrub(expected));
 const small=await sharp(raw,{raw:{width:base.width,height:base.height,channels:4,premultiplied:false}}).resize(out.width,out.height,{fit:'fill',kernel:'lanczos3'}).raw().toBuffer(),wrong=stagedImages({width:out.width,height:out.height,data:new Uint8ClampedArray(small)},s.imageLayers,[a]);assert.notDeepEqual(scrub(wrong.data),scrub(expected),'overlay must not be rerendered on final file pixels');
});

test('native image placement uses EXIF-oriented original canvas and strips source orientation on output',async()=>{
 const im=picture(73,41),bytes=new Uint8Array(await sharp(Buffer.from(im.data),{raw:{width:im.width,height:im.height,channels:4}}).flatten({background:'#ffffff'}).jpeg({quality:100}).withMetadata({orientation:6}).toBuffer()),a=asset(2,1,[213,43,7,255,19,67,241,173]),s=settings({imageLayers:[layer(a,{x:.25,y:.7,size:.6,rotation:90})]}),before=sha(bytes),base=await decoded(bytes),expected=stagedImages(base,s.imageLayers,[a]),out=await render(request(bytes,{settings:s,imageAssets:[a]}));
 assert.deepEqual([base.width,base.height],[41,73]);assert.deepEqual([out.originalWidth,out.originalHeight,out.width,out.height],[41,73,41,73]);assert.deepEqual(await outputPixels(out.bytes),scrub(expected.data));assert.equal(sha(bytes),before);assert.equal((await sharp(out.bytes).metadata()).orientation,undefined);
});

test('native JPEG equals explicit white-flatten encoding after image compositing',async()=>{
 const bytes=await png(picture(41,29)),a=asset(2,1,[210,17,86,73,15,231,93,241]),s=settings({imageLayers:[layer(a,{size:.9,opacity:.5,rotation:-14})]}),expected=stagedImages(await decoded(bytes),s.imageLayers,[a]),encoded=await sharp(scrub(expected.data),{raw:{width:expected.width,height:expected.height,channels:4}}).withIccProfile('srgb').flatten({background:'#ffffff'}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer(),out=await render(request(bytes,{settings:s,imageAssets:[a],format:'jpeg'}));assert.deepEqual(Buffer.from(out.bytes),encoded);assert.equal((await sharp(out.bytes).metadata()).hasAlpha,false);
});

test('four independently addressed layers render in order; fifth layers and relabelled dimensions fail before worker creation',async()=>{
 const bytes=await png(picture(32,24)),assets=Array.from({length:4},(_,i)=>asset(1,1,[31+i*53,217-i*31,19+i*29,70+i*47])),layers=assets.map((a,i)=>layer(a,{size:.8,x:.35+i*.1,rotation:i*17},{id:'image:'+i})),s=settings({imageLayers:layers}),expected=stagedImages(await decoded(bytes),layers,assets),out=await render(request(bytes,{settings:s,imageAssets:assets}));assert.deepEqual(await outputPixels(out.bytes),scrub(expected.data));
 let workers=0;class Never{constructor(){workers++;}}await assert.rejects(render(request(bytes,{settings:settings({imageLayers:[...layers,{...layers[0],id:'image:5'}]}),imageAssets:assets}),{WorkerClass:Never}));assert.equal(workers,0);
 const a=asset(2,1,[1,2,3,4,5,6,7,8]);await assert.rejects(render(request(bytes,{settings:settings({imageLayers:[layer(a)]}),imageAssets:[{...a,width:1,height:2}]}),{WorkerClass:Never}),/哈希/);assert.equal(workers,0);
});

test('late native worker publication after cancellation cannot settle or contaminate the replacement export',async()=>{
 const bytes=await png(picture(11,7)),a=asset(),r=request(bytes,{settings:settings({imageLayers:[layer(a)]}),imageAssets:[a]}),workers=[];
 class Deferred extends EventEmitter{constructor(filename,options){super();this.request=options.workerData;workers.push(this);}terminate(){this.terminated=true;return Promise.resolve(0);}finish(){this.emit('message',{ok:true,bytes:bytes.slice(),...structuredClone(this.request.plan),details:structuredClone(Core.resamplingDetails(this.request.plan))});}}
 const service=createExportRenderer({WorkerClass:Deferred});try{const first=service.render(r);assert.equal(service.cancel(r.requestId),true);await assert.rejects(first,e=>e.name==='AbortError');assert.equal(workers[0].terminated,true);let settled=false;const next=service.render({...r,requestId:'image-independent:replacement'}).then(v=>{settled=true;return v;});workers[0].finish();await Promise.resolve();assert.equal(settled,false);assert.equal(service.isBusy(),true);workers[1].finish();assert.equal((await next).imageLayered,true);assert.equal(service.isBusy(),false);}finally{service.dispose();}
});

test('preview final-canvas and combined four-layer work admission reject before readback or worker allocation',async()=>{
 const h=browserHarness(),a=asset(),config=[{width:4000,height:4000,settings:settings({imageLayers:[layer(a)],canvasPadding:{...Padding.defaults(),left:.1}})},{width:4096,height:4096,settings:settings({imageLayers:Array.from({length:4},(_,i)=>layer(a,{size:2},{id:'image:'+i}))})}];
 for(const item of config){const canvas=new h.Canvas(item.width,item.height);await assert.rejects(h.api.render(canvas,h.local(item.settings),h.local(analysis),h.local({imageAssets:[a]})));assert.equal(canvas.reads,0);}assert.equal(h.workers.length,0);assert.equal(h.creates(),0);
});
