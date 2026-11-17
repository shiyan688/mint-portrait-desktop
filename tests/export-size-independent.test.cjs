'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{EventEmitter}=require('node:events');
const Size=require('../src/export-size.cjs'),Resize=require('../src/export-resize.cjs'),Core=require('../export-render-core.cjs'),Project=require('../src/project-document.cjs'),Text=require('../src/text-overlay.cjs'),Layers=require('../src/text-layers.cjs');
const {createExportRenderer}=require('../export-renderer.cjs'),sharp=require('sharp');
const {Native,nativePath,fontRegistrations,fixture}=require('../quality/text-qa/native-support.cjs');
const {harness}=require('../quality/export-size-qa/app-harness.cjs');
const OUT=path.join(__dirname,'../quality/export-size-qa'),sha=b=>crypto.createHash('sha256').update(b).digest('hex'),plain=x=>JSON.parse(JSON.stringify(x));
const recipe=n=>({version:1,mode:'long-edge',longEdge:n}),settings=x=>({...structuredClone(Project.DEFAULT_SETTINGS),...x});
const layer=(id='title',r={})=>({id,enabled:true,recipe:{...Text.defaults(),text:'薄荷 Mint\nFINAL SIZE',...r}});
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};},pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<500&&!fn();n++)await pause(2);assert.ok(fn(),'asynchronous checkpoint reached');}
async function ready(o={}){const h=harness(o);await until(()=>h.api.get().presetOperation===null);return h;}
const nativeTest=(name,fn)=>test(name,{skip:!Native},fn);
const rgba=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
function canvas(w,h,data){const c=Native.createCanvas(w,h),ctx=c.getContext('2d'),im=ctx.createImageData(w,h);im.data.set(data);ctx.putImageData(im,0,0);return c;}
async function png(w,h,data){return new Uint8Array(await sharp(Buffer.from(data),{raw:{width:w,height:h,channels:4}}).png().toBuffer());}
async function request(w,h,data,changes={},extra={}){return{requestId:'size-independent',sourceRevision:'size:original',bytes:await png(w,h,data),settings:settings(changes),analysis:{landmarks:[]},mode:'original',format:'png',quality:1,...extra};}
async function render(r){const s=createExportRenderer();try{return await s.render(r);}finally{s.dispose();}}
async function decoded(bytes){return sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});}
function oracle(w,h,edge){if(edge>Math.max(w,h))throw Error('upscale');return w>=h?{width:edge,height:Math.max(1,Math.floor(h*edge/w+.5))}:{width:Math.max(1,Math.floor(w*edge/h+.5)),height:edge};}
function addPhoto(h,id,w,hh,s={}){const p=h.photo(id,s);p.originalWidth=w;p.originalHeight=hh;p.blob=new Blob([fixture(w,hh).toBuffer('image/png')],{type:'image/png'});return p;}

test('size independent planner: exhaustive small orientations use exact longedge/half-up, never implicit upscale',()=>{
 for(let w=1;w<=49;w++)for(let h=1;h<=49;h++)for(const e of [1,Math.max(1,Math.floor(Math.max(w,h)/2)),Math.max(w,h)]){const p=Size.plan(w,h,recipe(e));assert.deepEqual(p.output,oracle(w,h,e));assert.equal(Math.max(p.output.width,p.output.height),e);assert.equal(p.resized,e<Math.max(w,h));assert.equal(p.allocation.extraBytes,p.resized?p.output.width*p.output.height*4:0);}
 assert.deepEqual(Size.plan(10,5,recipe(3)).output,{width:3,height:2});assert.deepEqual(Size.plan(16384,1,recipe(1)).output,{width:1,height:1});assert.throws(()=>Size.plan(100,80,recipe(101)),/upscal/i);
 assert.deepEqual(Size.plan(12,7,Size.defaults()).output,{width:12,height:7});
});

test('size independent strict recipe: rejects getters, unknown/symbol/non-enumerable/inherited fields and numeric coercion',()=>{
 let read=0;const getter={version:1,mode:'long-edge',get longEdge(){read++;return 50;}};
 const nonenum=recipe(50);Object.defineProperty(nonenum,'longEdge',{value:50,enumerable:false});
 for(const bad of [undefined,null,[],Object.assign(new Date(),recipe(50)),{...recipe(50),extra:1},{...recipe(50),[Symbol('x')]:1},getter,nonenum,Object.create(recipe(50)),{version:1,mode:'unchanged',longEdge:0},{version:2,mode:'long-edge',longEdge:50},...['50',NaN,Infinity,0,-1,1.1,16385,true,1n].map(longEdge=>({...recipe(50),longEdge}))])assert.throws(()=>Size.validate(bad));
 assert.equal(read,0);const input=Object.assign(Object.create(null),recipe(30)),p=Size.plan(100,80,input);input.longEdge=1;assert.equal(p.recipe.longEdge,30);
});

test('size independent safety: tiny final target cannot bypass source, intermediate, portrait or full-resolution text budget',()=>{
 for(const [w,h]of [[16385,1],[8001,8000],[4000.5,1],[1,NaN]])assert.throws(()=>Size.plan(w,h,recipe(1)));
 assert.throws(()=>Core.sizePlan(8001,8000,'working',settings({}),recipe(1)),/6400/);
 assert.throws(()=>Core.sizePlan(8000,8000,'original',settings({canvasPadding:{version:1,top:.5,right:.5,bottom:.5,left:.5,color:'#ffffff',opacity:1}}),recipe(1)),/budget|6400|pixel/i);
 assert.throws(()=>Core.sizePlan(5000,4000,'original',settings({textLayers:[layer()]}),recipe(1)),/1600/);
 assert.throws(()=>Core.sizePlan(5000,4000,'original',settings({smooth:5,framing:{version:1,crop:{x:0,y:0,w:.01,h:.01},quarterTurns:0,flipX:false,flipY:false}}),recipe(1)),/1600/);
 const p=Core.sizePlan(5000,4000,'working',settings({textLayers:[layer()]}),recipe(200));assert.equal(p.processingWidth,4096);assert.equal(p.compositionWidth,4096);assert.equal(p.width,200);
});

test('size independent neutral: omitted, unchanged and equal-edge preserve decoded/encoded old path',async()=>{
 const w=17,h=11,data=Uint8Array.from({length:w*h*4},(_,i)=>i%4===3?255:(i*31)%256),r=await request(w,h,data);
 const old=await render(r),unchanged=await render({...r,requestId:'size-reset',outputSize:Size.defaults()}),equal=await render({...r,requestId:'size-equal',outputSize:recipe(w)});
 assert.deepEqual(old.bytes,unchanged.bytes);assert.deepEqual(old.bytes,equal.bytes);assert.equal('compositionWidth'in old,false);assert.equal('compositionWidth'in unchanged,false);assert.equal(equal.outputSizePlan.resized,false);assert.equal(equal.details.resampling,'none');
});

nativeTest('size independent authored DOM/real Canvas: output form changes no source/history/project/text basis',async()=>{
 const h=await ready(),p=h.activate(h.photo('immutable',{textLayers:[layer()]}));await h.api.renderCurrent();const before=plain({settings:p.settings,committed:p.committed,undo:p.undo,redo:p.redo,revision:p.revision}),source=sha(rgba(h.api.get().source)),cache=h.api.get().textRasterCache,accepted=h.api.get().acceptedRender,fingerprint=h.api.projectFingerprint();
 h.output(47);assert.match(h.get('exportPlan').textContent,/47 × 38/);assert.deepEqual(plain({settings:p.settings,committed:p.committed,undo:p.undo,redo:p.redo,revision:p.revision}),before);assert.equal(sha(rgba(h.api.get().source)),source);assert.equal(h.api.get().textRasterCache,cache);assert.equal(h.api.get().acceptedRender,accepted);assert.equal(h.api.projectFingerprint(),fingerprint);assert.deepEqual([cache.raster.width,cache.raster.height],[100,80]);
 await h.api.renderCurrent();assert.equal(h.api.get().textRasterCache,cache);assert.equal(h.calls.textRasters.length,1);await h.api.saveProject();const saved=await Project.decode(h.calls.saved[0].bytes);assert.equal('outputSize'in saved.photos[0].settings,false);assert.equal('outputSize'in saved.photos[0],false);assert.deepEqual(saved.photos[0].settings.textLayers,plain(p.settings.textLayers));
 h.output(null);assert.deepEqual(plain({settings:p.settings,committed:p.committed,undo:p.undo,redo:p.redo,revision:p.revision}),before);
});

nativeTest('size independent authored DOM: invalid fields and inadmissible text stop before native submission',async()=>{
 let submissions=0;const h=await ready({bridge:{renderExport:async()=>{submissions++;throw Error('must not submit');}}}),p=h.activate();
 for(const v of ['',0,-1,1.5,'2e2',' 50 ','NaN',16385]){h.output(v);await h.api.startExport();assert.equal(submissions,0);assert.equal(h.calls.writes.length,0);assert.equal(h.api.get().exportQueue,null);}
 p.originalWidth=5000;p.originalHeight=4000;p.settings.textLayers=[layer()];h.output(1);await h.api.startExport();assert.equal(submissions,0);assert.match(h.api.get().exportQueue.items[0].error,/1600/);assert.equal(h.calls.textEnvelopes.length,0);
});

nativeTest('size independent app/native batch: landscape and portrait succeed, smaller input fails without upscale',async()=>{
 const service=createExportRenderer(),requests=[];const h=await ready({bridge:{renderExport:async r=>{requests.push(r);return service.render(structuredClone(r));}}});
 try{h.activate(addPhoto(h,'landscape',120,80));addPhoto(h,'portrait',80,120);addPhoto(h,'too-small',30,20);h.output(60);await h.api.startExport();const q=h.api.get().exportQueue;assert.deepEqual(plain(q.items.map(x=>x.state)),['saved','saved','failed']);assert.deepEqual(plain(q.items.slice(0,2).map(x=>[x.output.width,x.output.height])),[[60,40],[40,60]]);assert.match(q.items[2].error,/upscal|不允许放大/i);assert.equal(requests.length,2);assert.equal(h.calls.writes.length,2);for(const p of h.api.photos)assert.equal(p.undo.length,0);
 }finally{service.dispose();}
});

nativeTest('size independent app: retry owns frozen target/settings and does not repeat prior successes',async()=>{
 const service=createExportRenderer(),requests=[];let fail=true;const h=await ready({bridge:{renderExport:async r=>{requests.push(structuredClone(r));if(fail&&r.sourceRevision.startsWith('retry-b:'))throw Error('injected export failure');return service.render(structuredClone(r));}}});
 try{h.activate(addPhoto(h,'retry-a',100,80));addPhoto(h,'retry-b',80,100);h.output(50);await h.api.startExport();const q=h.api.get().exportQueue;assert.deepEqual(plain(q.items.map(x=>x.state)),['saved','failed']);assert.ok(Object.isFrozen(q.options.outputSize));h.output(25);h.api.photos[1].settings.exposure=40;fail=false;await h.api.startExport(undefined,true);assert.deepEqual(requests.map(r=>r.outputSize.longEdge),[50,50,50]);assert.equal(requests.at(-1).settings.exposure,0);assert.equal(h.calls.writes.length,2);assert.deepEqual(plain(q.items.map(x=>x.state)),['saved','saved']);assert.deepEqual(plain(q.items.map(x=>x.attempts)),[1,2]);
 }finally{service.dispose();}
});

nativeTest('size independent app: corrupt final or composition dimensions are rejected before file write',async()=>{
 for(const field of ['width','height','compositionWidth','compositionHeight']){const h=await ready({bridge:{renderExport:async r=>{const p=Core.validateRequest(structuredClone(r)).plan;return{...p,[field]:p[field]+1,bytes:new Uint8Array([1])};}}});h.activate();h.output(50);await h.api.startExport();assert.equal(h.calls.writes.length,0,field);assert.equal(h.api.get().exportQueue.items[0].state,'failed');}
});

nativeTest('size independent app: cancelled/pagehidden native result cannot write and changed source cannot retry stale snapshot',async()=>{
 for(const event of ['cancel','pagehide']){const gate=defer(),entered=defer();let plan;const h=await ready({bridge:{renderExport:async r=>{plan=Core.validateRequest(structuredClone(r)).plan;entered.resolve();return gate.promise;}}});const p=h.activate();h.output(50);const run=h.api.startExport();await entered.promise;if(event==='cancel')h.api.cancelExport();else h.events.get('pagehide')();gate.resolve({...plan,bytes:new Uint8Array([1])});await run;assert.equal(h.calls.writes.length,0);assert.equal(h.api.get().exportQueue.items[0].state,'cancelled');if(event==='cancel'){p.sourceRevision+=':replaced';h.output(20);await h.api.startExport(undefined,true);assert.match(h.get('toast').textContent,/已改变|移除/);assert.equal(h.calls.writes.length,0);}}
});

test('size independent main: forged metadata and encoded dimensions fail before resolving worker result',async()=>{
 const r=await request(12,8,Uint8Array.from({length:12*8*4},(_,i)=>i%4===3?255:90),{}, {outputSize:recipe(6)}),good=await render(r),old=await render({...r,outputSize:Size.defaults()});
 for(const mutate of [x=>x.compositionWidth++,x=>{delete x.compositionHeight;},x=>{x.outputSizePlan.input.width++;},x=>{x.outputSizePlan.output.width++;},x=>{x.outputSizePlan.resized=false;},x=>{x.bytes=old.bytes;},x=>{x.width++;}]){class Fake extends EventEmitter{constructor(){super();queueMicrotask(()=>{const out=structuredClone({...good,ok:true});mutate(out);this.emit('message',out);});}terminate(){return Promise.resolve(0);}}const s=createExportRenderer({WorkerClass:Fake});try{await assert.rejects(s.render(r),/校验|不匹配/);}finally{s.dispose();}}
});

test('size independent native alpha: hidden colored RGB does not contaminate resized PNG or JPEG white flatten',async()=>{
 const w=121,h=79,dirty=new Uint8Array(w*h*4),clean=new Uint8Array(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,alpha=x>23&&x<98&&y>17&&y<62?(x<32||x>89?85:255):0;dirty.set(alpha?[30,175,125,alpha]:[255,0,247,0],i);clean.set(alpha?[30,175,125,alpha]:[0,0,0,0],i);}
 const dirtyHash=sha(dirty);const a=await request(w,h,dirty,{}, {outputSize:recipe(47)}),b=await request(w,h,clean,{}, {outputSize:recipe(47)}),out=await render(a),plainOut=await render(b),raw=await decoded(out.bytes);assert.deepEqual(raw.data,(await decoded(plainOut.bytes)).data,'hidden RGB must not bleed at transparent color edges');
 const sourceRaw=await decoded(a.bytes);let inputHiddenPixels=0;for(let i=0;i<sourceRaw.data.length;i+=4)if(!sourceRaw.data[i+3]&&sourceRaw.data[i]===255&&sourceRaw.data[i+2]===247)inputHiddenPixels++;assert.equal(inputHiddenPixels,6303,'encoded source genuinely contains hidden magenta, not a sanitized test fixture');let zero=0;for(let i=0;i<raw.data.length;i+=4)if(!raw.data[i+3]){zero++;assert.deepEqual(Array.from(raw.data.subarray(i,i+3)),[0,0,0]);}assert.ok(zero>100);
 const jpeg=await render({...a,format:'jpeg'}),jpg=await decoded(jpeg.bytes),expectedJPEG=await sharp(raw.data,{raw:{width:raw.info.width,height:raw.info.height,channels:4}}).withIccProfile('srgb').flatten({background:'#ffffff'}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer();assert.deepEqual(jpeg.bytes,new Uint8Array(expectedJPEG),'JPEG flattens white only after identical final resample');assert.ok(jpg.data[0]>=253&&jpg.data[1]>=253&&jpg.data[2]>=253);assert.equal(sha(dirty),dirtyHash);
 fs.writeFileSync(path.join(OUT,'alpha-source.png'),a.bytes);fs.writeFileSync(path.join(OUT,'alpha-final.png'),out.bytes);fs.writeFileSync(path.join(OUT,'alpha-final.jpg'),jpeg.bytes);fs.writeFileSync(path.join(OUT,'alpha-evidence.json'),JSON.stringify({source:{width:w,height:h,rgbaSHA256:sha(dirty),hiddenMagentaPixels:inputHiddenPixels},output:{width:out.width,height:out.height,zeroAlphaPixels:zero,decodedRGBA_SHA256:sha(raw.data),jpegDecodedRGBA_SHA256:sha(jpg.data)},hiddenRGBInvariant:true,jpegFinalWhiteFlattenExact:true},null,2)+'\n');
});

nativeTest('size independent real Canvas fallback: final resize after text, neutral identity, cancellation cleanup',async()=>{
 const input=fixture(83,51),before=sha(rgba(input));let allocations=0;
 assert.equal(Resize.applyCanvas(input,Size.defaults(),()=>{allocations++;}),input);assert.equal(Resize.applyCanvas(input,recipe(83),()=>{allocations++;}),input);assert.equal(allocations,0);
 const output=Resize.applyCanvas(input,recipe(37),(w,h)=>Native.createCanvas(w,h));assert.deepEqual([output.width,output.height],[37,23]);assert.equal(sha(rgba(input)),before);const expected=Native.createCanvas(37,23),ctx=expected.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(input,0,0,83,51,0,0,37,23);assert.equal(sha(rgba(output)),sha(rgba(expected)));
 const controller=new AbortController();let allocated;assert.throws(()=>Resize.applyCanvas(input,recipe(37),(w,h)=>{allocated=Native.createCanvas(w,h);controller.abort();return allocated;},{signal:controller.signal}),{name:'AbortError'});assert.deepEqual([allocated.width,allocated.height],[1,1]);assert.deepEqual([input.width,input.height],[83,51]);assert.throws(()=>Resize.applyCanvas(input,recipe(37),()=>input),/独立/);
 const encoded=[],h=await ready({pipeline:{encode:async c=>{encoded.push({width:c.width,height:c.height,hash:sha(rgba(c))});return new Uint8Array(canvas(c.width,c.height,rgba(c)).toBuffer('image/png'));}}});h.activate(h.photo('fallback',{textLayers:[layer('t',{size:.22})],canvasPadding:{version:1,top:.1,right:.1,bottom:.1,left:.1,color:'#234567',opacity:1}}));h.output(43);await h.api.startExport();assert.equal(h.calls.writes.length,1);assert.equal(h.calls.textRasters[0].width,116);assert.equal(h.calls.textRasters[0].height,96);assert.deepEqual([encoded[0].width,encoded[0].height],[43,36]);assert.deepEqual([(await decoded(h.calls.writes[0].bytes)).info.width,(await decoded(h.calls.writes[0].bytes)).info.height],[43,36]);
});

nativeTest('size independent original/working preview retains composition text basis, final output never relayouts',async()=>{
 const service=createExportRenderer(),requests=[],results=[],h=await ready({bridge:{renderExport:async r=>{requests.push(structuredClone(r));const result=await service.render(structuredClone(r));results.push(result);return result;}}});
 try{const p=h.activate(addPhoto(h,'basis',5000,80,{textLayers:[layer('line',{text:'Full composition text basis',size:.45})]}));h.api.set({source:h.canvas(1000,16)});await h.api.renderCurrent();assert.equal(h.api.get().renderFailure,'');const original=h.api.get().textRasterCache;assert.deepEqual([original.raster.width,original.raster.height],[5000,80]);h.output(200);await h.api.renderCurrent();assert.equal(h.api.get().textRasterCache,original);assert.deepEqual([h.api.get().rendered.width,h.api.get().rendered.height],[1000,16]);
 h.get('exportMode').value='working';h.fire('exportMode','change');await until(()=>h.api.get().acceptedRender&&h.api.get().textRasterCache!==original);const working=h.api.get().textRasterCache;assert.deepEqual([working.raster.width,working.raster.height],[4096,66]);h.output(150);await h.api.renderCurrent();assert.equal(h.api.get().textRasterCache,working);await h.api.startExport();assert.equal(h.calls.writes.length,1);assert.deepEqual([requests[0].textOverlay.width,requests[0].textOverlay.height],[4096,66]);assert.deepEqual([results[0].width,results[0].height],[150,2]);assert.equal(results[0].details.resampling,'explicit-working-size-lanczos3+final-output-lanczos3');assert.deepEqual([p.originalWidth,p.originalHeight],[5000,80]);
 }finally{service.dispose();}
});

nativeTest('size independent original text envelope stays bound to pre-resize composition/request/source/recipe/mode',async()=>{
 const h=await ready({bridge:{renderExport:async r=>{h.request=structuredClone(r);throw Error('capture only');}}});h.activate(h.photo('binding',{textLayers:[layer()]}));h.output(40);await h.api.startExport();const r=h.request;assert.ok(r);const plan=Core.validateRequest(r).plan;assert.deepEqual([r.textOverlay.width,r.textOverlay.height],[100,80]);assert.deepEqual([plan.width,plan.height],[40,32]);
 for(const[key,value]of Object.entries({requestId:'stale',sourceRevision:'stale:source',sourceHash:'0'.repeat(64),recipeHash:'0'.repeat(64),mode:'working',width:40,height:32}))assert.throws(()=>Core.validateRequest({...r,textOverlay:{...r.textOverlay,[key]:value}}),/覆盖层/);
 const finalOverlay={...r.textOverlay,width:40,height:32,rgba:new Uint8Array(40*32*4)};assert.throws(()=>Core.validateRequest({...r,textOverlay:finalOverlay}),/width/);
});

nativeTest('size independent actual native PNG evidence: effects, crop, turn, padding and full-resolution text THEN final resample',async()=>{
 const service=createExportRenderer(),requests=[],results=[],h=await ready({bridge:{renderExport:async r=>{requests.push(structuredClone(r));const result=await service.render(structuredClone(r));results.push(result);return result;}}});
 try{
 const w=900,hh=640,s={exposure:9,framing:{version:1,crop:{x:.08,y:.1,w:.82,h:.8},quarterTurns:1,flipX:true,flipY:false},canvasPadding:{version:1,top:.08,right:.12,bottom:.14,left:.12,color:'#16362e',opacity:1},textLayers:[
 layer('title',{text:'薄荷人像\nMINT PORTRAIT',size:.085,y:.21,rotation:-6,color:'#ffffff',outlineWidth:.04,outlineColor:'#103526',shadow:true}),
 layer('body',{text:'完整排版 · 最后缩小\nCompose first. Resize last.',size:.058,y:.57,rotation:5,color:'#8ff5c7',fontFamily:'serif',italic:true,shadow:true}),
 layer('footer',{text:'SOURCE → CROP → PADDING\nTEXT → FINAL SIZE',size:.03,y:.96,lineHeight:1.2,fontFamily:'mono',color:'#c9e4d9',bold:false})]};
 const p=h.activate(addPhoto(h,'visual',w,hh,s));h.api.set({source:h.canvas(w,hh)});const originalHash=sha(new Uint8Array(await p.blob.arrayBuffer())),sourceHash=sha(rgba(h.api.get().source)),savedState=plain({settings:p.settings,undo:p.undo,redo:p.redo,revision:p.revision});await h.api.renderCurrent();assert.equal(h.api.get().renderFailure,'');const cache=h.api.get().textRasterCache,accepted=h.api.get().acceptedRender;
 h.output(null);await h.api.startExport();assert.equal(h.calls.writes.length,1);h.output(371);await h.api.startExport();assert.equal(h.calls.writes.length,2);assert.equal(h.api.get().textRasterCache,cache);assert.deepEqual([requests[1].textOverlay.width,requests[1].textOverlay.height],[results[0].width,results[0].height]);assert.equal(sha(requests[0].textOverlay.rgba),sha(requests[1].textOverlay.rgba));
 const full=await decoded(results[0].bytes),small=await decoded(results[1].bytes),resized=await sharp(full.data,{raw:{width:full.info.width,height:full.info.height,channels:4}}).resize(small.info.width,small.info.height,{fit:'fill',kernel:'lanczos3',withoutEnlargement:true}).raw().toBuffer();for(let i=0;i<resized.length;i+=4)if(resized[i+3]===0)resized[i]=resized[i+1]=resized[i+2]=0;assert.deepEqual(small.data,resized,'final native pixels exactly equal resampling the already finished full-resolution composition');
 const source=await sharp(requests[0].bytes).autoOrient().withIccProfile('srgb').toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true}),base=Core.processPixels({width:w,height:hh,data:new Uint8ClampedArray(source.data)},{...plain(p.settings),textLayers:[]},{landmarks:[],sourceRevision:p.sourceRevision});
 const overlay=requests[0].textOverlay.rgba,scalar=new Uint8ClampedArray(base.data);for(let i=0;i<scalar.length;i+=4){const a=overlay[i+3],b=base.data[i+3],den=255*a+(255-a)*b;if(a){for(let c=0;c<3;c++)scalar[i+c]=Math.round((255*a*overlay[i+c]+(255-a)*b*base.data[i+c])/den);scalar[i+3]=Math.round(den/255);}if(scalar[i+3]===0)scalar[i]=scalar[i+1]=scalar[i+2]=0;}assert.deepEqual(full.data,Buffer.from(scalar),'full-resolution text matches independent scalar source-over');
 const resizedBase=await sharp(Buffer.from(base.data),{raw:{width:base.width,height:base.height,channels:4}}).resize(small.info.width,small.info.height,{fit:'fill',kernel:'lanczos3'}).raw().toBuffer(),wrongText=Native.createCanvas(small.info.width,small.info.height),wrongCtx=wrongText.getContext('2d');for(const l of p.settings.textLayers)Text.render(wrongCtx,small.info.width,small.info.height,structuredClone(l.recipe));const wrong=Layers.composite({width:small.info.width,height:small.info.height,data:new Uint8ClampedArray(resizedBase)},{width:small.info.width,height:small.info.height,rgba:new Uint8Array(rgba(wrongText))});assert.notEqual(sha(small.data),sha(wrong.data),'rerasterizing at final file size is observably different and not used');
 let glyphsInBottomPadding=0;for(let y=779;y<full.info.height;y++)for(let x=0;x<full.info.width;x++)if(overlay[(y*full.info.width+x)*4+3])glyphsInBottomPadding++;assert.ok(glyphsInBottomPadding>100,'full-resolution glyph pixels occupy actual padding before final resize');const differences={channels:0,max:0};for(let i=0;i<small.data.length;i++){const delta=Math.abs(small.data[i]-wrong.data[i]);if(delta)differences.channels++;differences.max=Math.max(differences.max,delta);}
 assert.equal(sha(new Uint8Array(await p.blob.arrayBuffer())),originalHash);assert.equal(sha(rgba(h.api.get().source)),sourceHash);assert.deepEqual(plain({settings:p.settings,undo:p.undo,redo:p.redo,revision:p.revision}),savedState);
 fs.writeFileSync(path.join(OUT,'source.png'),requests[0].bytes);fs.writeFileSync(path.join(OUT,'composition-native.png'),results[0].bytes);fs.writeFileSync(path.join(OUT,'final-native.png'),results[1].bytes);fs.writeFileSync(path.join(OUT,'preview.png'),canvas(accepted.width,accepted.height,rgba(accepted.canvas)).toBuffer('image/png'));fs.writeFileSync(path.join(OUT,'incorrect-relayout-control.png'),await png(wrong.width,wrong.height,wrong.data));
 const report={scope:'Synthetic image; shipped app in authored DOM/IPC shell; installed NativeCanvas text; actual native worker Sharp PNGs. Non-text preview is an adapter to the actual pixel core.',nativeCanvas:{path:nativePath,version:require(path.join(nativePath,'package.json')).version,fonts:fontRegistrations},sharp:sharp.versions.sharp,source:{width:w,height:hh,pngSHA256:originalHash,sourceCanvasSHA256:sourceHash},composition:{width:full.info.width,height:full.info.height,decodedRGBA_SHA256:sha(full.data),scalarSourceOverSHA256:sha(scalar),textRGBA_SHA256:sha(overlay),glyphPixelsInBottomPadding:glyphsInBottomPadding},final:{width:small.info.width,height:small.info.height,pngSHA256:sha(results[1].bytes),decodedRGBA_SHA256:sha(small.data),finishedCompositionResampleSHA256:sha(resized),incorrectRelayoutSHA256:sha(wrong.data),incorrectRelayoutDifference:differences},preview:{width:accepted.width,height:accepted.height,textBasisWidth:cache.raster.width,textBasisHeight:cache.raster.height},outputSize:recipe(371),settings:plain(p.settings),limitations:['No Electron/browser screenshot or Windows installer executed.','Authored DOM and IPC shell, with actual app logic and native pixels.','Same installed Sharp Lanczos3 is used for the independent sequencing oracle, not a separately implemented kernel.','No new dependencies, fonts, models, network, API calls or private images.']};fs.writeFileSync(path.join(OUT,'native-evidence.json'),JSON.stringify(report,null,2)+'\n');
 const contact=Native.createCanvas(1160,800),ctx=contact.getContext('2d');ctx.fillStyle='#0b1a17';ctx.fillRect(0,0,1160,800);ctx.fillStyle='#d5f4e4';ctx.font='bold 25px sans-serif';ctx.fillText('FINAL EXPORT SIZE · independent native pixel evidence',24,38);ctx.font='16px sans-serif';ctx.fillStyle='#a5c5b7';ctx.fillText('Synthetic fixture | Linux NativeCanvas + Sharp | not a browser or Windows screenshot',24,65);
 async function panel(name,label,x,y,maxW,maxH){const img=await Native.loadImage(path.join(OUT,name));const scale=Math.min(maxW/img.width,maxH/img.height);ctx.fillStyle='#d5f4e4';ctx.font='bold 17px sans-serif';ctx.fillText(label,x,y-12);ctx.drawImage(img,x,y,Math.round(img.width*scale),Math.round(img.height*scale));}
 await panel('source.png',`1  Source ${w} × ${hh}`,24,115,280,210);await panel('composition-native.png',`2  Finished composition ${full.info.width} × ${full.info.height}`,340,115,360,490);await panel('final-native.png',`3  Final file ${small.info.width} × ${small.info.height}`,745,115,310,400);
 await panel('alpha-final.png','Alpha boundary / PNG',24,450,250,170);await panel('alpha-final.jpg','White flatten last / JPEG',24,660,180,115);ctx.font='16px sans-serif';ctx.fillStyle='#b4d5c5';ctx.fillText('Decoded final RGBA matches',745,560);ctx.fillText('resampled finished composition exactly.',745,585);ctx.fillText('Full text raster reused unchanged.',745,625);ctx.fillText('Hidden RGB invariant; original preserved.',745,650);ctx.font='14px monospace';ctx.fillText(sha(small.data).slice(0,32),745,700);ctx.fillText(sha(small.data).slice(32),745,720);fs.writeFileSync(path.join(OUT,'contact.png'),contact.toBuffer('image/png'));
 }finally{service.dispose();}
});
