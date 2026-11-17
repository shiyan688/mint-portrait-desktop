'use strict';
// Rehashed historical frames must not inherit newly introduced v16 fields.
function historicalImageFields(doc) {
  if (doc.format === 'mint-portrait-project' && doc.version < 16) for (const photo of doc.photos) {
    delete photo.imageAssets;
    for (const state of [photo.settings, photo.committed, ...photo.undo, ...photo.redo, photo.exportedSettings].filter(Boolean)) delete state.imageLayers;
  }
  return doc;
}

// Synthetic RGBA and actual Sharp exports only. Browser scheduling uses VM/Canvas
// doubles; this suite does not claim a native desktop UI or visual-browser test.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),sharp=require('sharp');
const P=require('../src/project-document.cjs'),R=require('../src/redaction-layers.cjs'),Redact=require('../src/redact-core.cjs').createProfile('desktop'),Geometry=require('../src/geometry.cjs'),Padding=require('../src/canvas-padding.cjs'),Text=require('../src/text-overlay.cjs'),TextLayers=require('../src/text-layers.cjs'),Core=require('../export-render-core.cjs'),{createExportRenderer}=require('../export-renderer.cjs');
const revision='synthetic-redaction:1',analysis={landmarks:[],sourceRevision:revision};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const settings=extra=>({...structuredClone(P.DEFAULT_SETTINGS),...extra});
const frame={version:1,crop:{x:.1,y:.2,w:.7,h:.6},quarterTurns:1,flipX:true,flipY:false};
const padding={version:1,top:.2,right:.1,bottom:.3,left:.15,color:'#4a9bc6',opacity:.4};
const selection=(extra={})=>({version:1,sourceRevision:revision,base:'all',inverted:false,feather:0,commands:[],...extra});
const recipe=(extra={})=>({...Redact.defaults(),mode:'cover',color:'#195d83',strokes:[{radius:.22,points:[{x:.25,y:.45},{x:.75,y:.45}]}],...extra});
function withRedactions(extra={},layers){const s=settings(extra);s.redactions={version:1,sourceRevision:revision,geometryKey:R.geometryKey(s),layers:layers||[{id:'redaction:1',name:'Synthetic cover',enabled:true,recipe:recipe(),selection:null}]};return s;}
function picture(width=41,height=29){const data=Uint8ClampedArray.from({length:width*height*4},(_,i)=>i%4===3?[0,1,64,128,254,255][Math.floor(i/4)%6]:(i*19+Math.floor(i/4)*11)%256);return{width,height,data};}
const context=(s,im)=>({sourceRevision:revision,settings:s,sourceSize:{width:im.width,height:im.height}});
const slots=p=>[p.settings,p.committed,...p.undo,...p.redo,p.exportedSettings];
async function png(im=picture()){return new Uint8Array(await sharp(Buffer.from(im.data),{raw:{width:im.width,height:im.height,channels:4}}).png().toBuffer());}
async function decoded(bytes,plan){let source=sharp(bytes).autoOrient().withIccProfile('srgb').toColourspace('srgb').ensureAlpha();if(plan?.scaled)source=source.resize(plan.processingWidth,plan.processingHeight,{fit:'fill',kernel:'lanczos3'});const d=await source.raw().toBuffer({resolveWithObject:true});return{width:d.info.width,height:d.info.height,data:new Uint8ClampedArray(d.data)};}
const request=(bytes,s,extra={})=>({requestId:'redaction-export:1',bytes,sourceRevision:revision,settings:s,analysis,mode:'original',format:'png',quality:1,...extra});
async function exported(req){const service=createExportRenderer();try{return await service.render(req);}finally{service.dispose();}}
function sanitize(im){const data=Buffer.from(im.data);for(let i=0;i<data.length;i+=4)if(data[i+3]===0)data[i]=data[i+1]=data[i+2]=0;return{...im,data};}
function worker(im,s,a=analysis){let result;const c=vm.createContext({self:{postMessage:value=>result=value}});c.importScripts=(...names)=>{for(const name of names)vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),c);};vm.runInContext(fs.readFileSync(require.resolve('../src/pixel-worker.js'),'utf8'),c);c.inputJSON=JSON.stringify({width:im.width,height:im.height,data:Array.from(im.data),settings:s,analysis:a});vm.runInContext('const i=JSON.parse(inputJSON);i.buffer=Uint8ClampedArray.from(i.data).buffer;delete i.data;self.onmessage({data:i});',c);if(result.error)throw Error(result.error);return{width:result.width,height:result.height,data:new Uint8ClampedArray(result.buffer)};}
function rewrite(bytes,change){const h=P.inspectHeader(bytes),doc=JSON.parse(Buffer.from(bytes.subarray(64,64+h.metadataBytes)));change(doc);const json=Buffer.from(JSON.stringify(historicalImageFields(doc))),payload=bytes.subarray(64+h.metadataBytes),header=Buffer.from(bytes.subarray(0,64));header.writeUInt32LE(doc.version,8);header.writeUInt32LE(json.length,16);header.writeUInt32LE(64+json.length+payload.length,24);Buffer.from(sha(json),'hex').copy(header,32);return Buffer.concat([header,json,payload]);}
async function project(){const bytes=await png();return{version:P.VERSION,currentId:'synthetic-photo:1',photos:[{id:'synthetic-photo:1',name:'synthetic.png',sourceRevision:revision,source:{bytes,mime:'image/png',width:41,height:29},selected:true,settings:withRedactions(),committed:withRedactions({exposure:5}),undo:[settings()],redo:[withRedactions({framing:frame})],exportedSettings:withRedactions({canvasPadding:padding}),revision:5,preset:null,imageAssets: [], learnedCache:[],review:{version:1,current:{rating:0,flag:'none',label:'none'},undo:[],redo:[]}}]};}
function bindText(req){const source=P.inspectImage(req.bytes,'image/png'),p=Core.sizePlan(source.width,source.height,req.mode,req.settings);return{version:1,requestId:req.requestId,sourceRevision:revision,sourceHash:sha(req.bytes),recipeHash:sha(TextLayers.canonicalRecipe(req.settings.textLayers)),mode:req.mode,width:p.width,height:p.height,rgba:Uint8Array.from({length:p.width*p.height*4},(_,i)=>i%4===3?255:[255,0,0][i%4])};}

test('redactions default neutral, legacy direct settings migrate null, and neutral workers preserve exact RGBA',()=>{
 assert.equal(P.DEFAULT_SETTINGS.redactions,null);const s=settings(),old={...s};delete old.redactions;assert.equal(P.validateSettings(old,{width:41,height:29},revision).redactions,null);
 const im=picture(),before=im.data.slice();assert.deepEqual(Core.processPixels(im,s,analysis),im);assert.deepEqual(worker(im,s),im);assert.deepEqual(im.data,before);
});
test('v11 roundtrip owns every history recipe and source bytes; no raster is persisted in settings',async()=>{
 const input=await project(),before=structuredClone(input),encoded=await P.encode(input),out=await P.decode(encoded);assert.equal(P.inspectHeader(encoded).version,P.VERSION);assert.equal(out.version,P.VERSION);assert.deepEqual(slots(out.photos[0]),slots(before.photos[0]));assert.deepEqual(out.photos[0].source.bytes,before.photos[0].source.bytes);assert.deepEqual(input,before);assert.deepEqual(await P.encode(out),encoded);
 assert.doesNotMatch(JSON.stringify(slots(out.photos[0])),/"(?:rgba|buffer|pixels|path|url)"/);out.photos[0].settings.redactions.layers[0].recipe.color='#ffffff';assert.equal(out.photos[0].committed.redactions.layers[0].recipe.color,'#195d83');
});
for(let version=1;version<=10;version++)test(`real rehashed v${version} migrates missing final redactions to null in all slots`,async()=>{
 const input=await project(),encoded=await P.encode(input),legacy=rewrite(encoded,d=>{d.version=version;for(const p of d.photos){if(version<6)delete p.review;for(const s of slots(p))delete s.redactions;}}),before=sha(legacy),out=await P.decode(legacy);assert.equal(out.version,P.VERSION);for(const s of slots(out.photos[0]))assert.equal(s.redactions,null);assert.deepEqual(out.photos[0].source.bytes,input.photos[0].source.bytes);assert.equal(sha(legacy),before);
});
for(let i=0;i<5;i++)test(`v11 slot ${i} requires redactions and rejects stale source/geometry in correctly rehashed imports`,async()=>{
 const input=await project(),encoded=await P.encode(input);delete slots(input.photos[0])[i].redactions;await assert.rejects(P.encode(input),/Missing settings field: redactions/);await assert.rejects(P.decode(rewrite(encoded,d=>delete slots(d.photos[0])[i].redactions)),/Missing settings field: redactions/);
 for(const change of [s=>{s.redactions=withRedactions().redactions;s.redactions.sourceRevision='other:1';},s=>{s.redactions=withRedactions().redactions;s.framing=frame;}])await assert.rejects(P.decode(rewrite(encoded,d=>change(slots(d.photos[0])[i]))),/redaction|source|geometry/i);
});
test('malformed recipes, fields, prototypes, sparse arrays and accessors fail without execution',async()=>{
 let reads=0;const valid=withRedactions(),bad=[];
 for(const key of ['redactions']){const s=structuredClone(valid);Object.defineProperty(s,key,{enumerable:true,get(){reads++;return valid[key];}});bad.push(s);}
 for(const where of ['root','layer','recipe','point']){const s=structuredClone(valid),target=where==='root'?s.redactions:where==='layer'?s.redactions.layers[0]:where==='recipe'?s.redactions.layers[0].recipe:s.redactions.layers[0].recipe.strokes[0].points[0];const key=where==='root'?'sourceRevision':where==='layer'?'enabled':where==='recipe'?'color':'x';Object.defineProperty(target,key,{enumerable:true,get(){reads++;return 1;}});bad.push(s);}
 for(const redactions of [undefined,{},[],{...valid.redactions,unexpected:true},{...valid.redactions,layers:new Array(1)},Object.assign(Object.create({unsafe:true}),valid.redactions)])bad.push({...valid,redactions});
 for(const s of bad)assert.throws(()=>P.validateSettings(s,{width:41,height:29},revision));assert.equal(reads,0);
 const encoded=await P.encode(await project());for(let version=1;version<=11;version++)await assert.rejects(P.decode(rewrite(encoded,d=>{d.version=version;if(version<6)delete d.photos[0].review;d.photos[0].settings.redactions={version:1};})),/redactions/i);
});
test('project takes an owned redaction snapshot before async hashing',async()=>{
 const input=await project(),before=structuredClone(input);let first=true;const bytes=await P.encode(input,{sha256:async value=>{if(first){first=false;input.photos[0].settings.redactions.layers[0].recipe.color='#ffffff';}return sha(value);}});assert.deepEqual(slots((await P.decode(bytes)).photos[0]),slots(before.photos[0]));
});
test('worker and native replay final cover after tone, crop/turn/flip and asymmetric padding exactly once',()=>{
 const im=picture(79,53),s=withRedactions({exposure:12,framing:frame,canvasPadding:padding}),before=im.data.slice(),upstream=Core.processPixels(im,{...s,redactions:null},analysis),expected=Redact.apply(upstream,s.redactions.layers[0].recipe);
 assert.deepEqual(Core.processPixels(im,s,analysis),expected);assert.deepEqual(worker(im,s),expected);assert.deepEqual(Core.processPixels(im,s,analysis),expected);assert.deepEqual(im.data,before);assert.notDeepEqual(expected.data,upstream.data);
 const mid=(Math.round((expected.height-1)*.45)*expected.width+Math.round((expected.width-1)*.5))*4;assert.deepEqual([...expected.data.slice(mid,mid+4)],[25,93,131,255]);
});
test('source selection is transformed through framing/padding and binds immutable geometry in worker/native',()=>{
 const im=picture(63,47),s=withRedactions({framing:frame,canvasPadding:padding});s.redactions.layers[0].selection=selection({base:'none',commands:[{kind:'lasso',mode:'add',points:[{x:.15,y:.2},{x:.7,y:.2},{x:.7,y:.8},{x:.15,y:.8}]}]});
 const expected=R.apply(Core.processPixels(im,{...s,redactions:null},analysis),s.redactions,context(s,im));assert.deepEqual(Core.processPixels(im,s,analysis),expected);assert.deepEqual(worker(im,s),expected);
 for(const changed of [{...s,framing:null},{...s,slim:1}]){assert.throws(()=>Core.processPixels(im,changed,analysis),/geometry|selected|warp/i);assert.throws(()=>worker(im,changed),/geometry|selected|warp/i);}
 assert.throws(()=>Core.processPixels(im,s,{...analysis,sourceRevision:'stale-source'}),/source/i);
});
test('native text compositing completes before opaque redaction and its RGB/alpha cannot be uncovered',async()=>{
 const s=withRedactions({framing:frame,canvasPadding:padding,textLayers:[{id:'text:1',enabled:true,recipe:{...Text.defaults(),text:'Synthetic identifier'}}]}),bytes=await png(),r=request(bytes,s);r.textOverlay=bindText(r);const source=await decoded(bytes),texted=Core.processPixels(source,{...s,redactions:null},analysis,r.textOverlay),expected=Redact.apply(texted,s.redactions.layers[0].recipe),actual=Core.processPixels(source,s,analysis,r.textOverlay);
 assert.deepEqual(actual,expected);const mid=(Math.round((actual.height-1)*.45)*actual.width+Math.round((actual.width-1)*.5))*4;assert.deepEqual([...actual.data.slice(mid,mid+4)],[25,93,131,255]);assert.throws(()=>Core.processPixels(source,s,analysis),/缺少/);
 const result=await exported(r),raw=await sharp(result.bytes).ensureAlpha().raw().toBuffer();assert.deepEqual(raw,sanitize(expected).data);assert.equal(result.details.textLayers,1);
});
for(const format of ['png','jpeg'])test(`actual ${format.toUpperCase()} redaction export matches composed pixels, final dimensions and metadata privacy`,async()=>{
 const im=picture(83,61),bytes=await png(im),before=bytes.slice(),s=withRedactions({exposure:5,framing:frame,canvasPadding:padding}),source=await decoded(bytes),expected=sanitize(R.apply(Core.processPixels(source,{...s,redactions:null},analysis),s.redactions,context(s,source))),result=await exported(request(bytes,s,{format})),meta=await sharp(result.bytes).metadata();
 assert.deepEqual([result.width,result.height,meta.width,meta.height],[expected.width,expected.height,expected.width,expected.height]);assert.equal(meta.exif,undefined);assert.equal(meta.xmp,undefined);assert.equal(meta.iptc,undefined);assert.equal(result.details.sourceExifPreserved,false);assert.deepEqual(bytes,before);
 if(format==='png'){assert.deepEqual(await sharp(result.bytes).ensureAlpha().raw().toBuffer(),expected.data);assert.equal(meta.hasAlpha,true);}else{const encoded=await sharp(expected.data,{raw:{width:expected.width,height:expected.height,channels:4}}).withIccProfile('srgb').flatten({background:'#ffffff'}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer();assert.deepEqual(Buffer.from(result.bytes),encoded);assert.equal(meta.hasAlpha,false);}
});
test('actual native export strips source EXIF/XMP after orientation and leaves source bytes intact',async()=>{
 const im=picture(31,23),bytes=new Uint8Array(await sharp(Buffer.from(im.data),{raw:{width:im.width,height:im.height,channels:4}}).flatten({background:'#ffffff'}).jpeg({quality:100}).withMetadata({orientation:6}).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">synthetic-private-identifier</x:xmpmeta>').toBuffer()),before=sha(bytes),s=withRedactions(),out=await exported(request(bytes,s)),meta=await sharp(out.bytes).metadata();assert.deepEqual([out.width,out.height],[23,31]);assert.equal(meta.exif,undefined);assert.equal(meta.xmp,undefined);assert.equal(meta.orientation,undefined);assert.equal(sha(bytes),before);
});
test('explicit output reduction happens after redaction, and working sizing uses the processing source',async()=>{
 const bytes=await png(picture(5000,17)),s=withRedactions({framing:frame,canvasPadding:padding}),r=request(bytes,s,{mode:'working',outputSize:{version:1,mode:'long-edge',longEdge:7}}),plan=Core.validateRequest(r).plan,source=await decoded(bytes,plan),redacted=Core.processPixels(source,s,analysis),resized=await sharp(Buffer.from(redacted.data),{raw:{width:redacted.width,height:redacted.height,channels:4,premultiplied:false}}).resize(plan.width,plan.height,{fit:'fill',kernel:'lanczos3',withoutEnlargement:true}).raw().toBuffer(),expected=sanitize({data:resized}).data,out=await exported(r);assert.deepEqual([out.width,out.height],[plan.width,plan.height]);assert.equal(out.processingWidth,4096);assert.deepEqual(await sharp(out.bytes).ensureAlpha().raw().toBuffer(),expected);assert.match(out.details.resampling,/working-size.*final-output/);
});
test('tiny final file cannot bypass actual redaction pixel, edge, work or cumulative layer budgets',()=>{
 const tiny={version:1,mode:'long-edge',longEdge:1};assert.throws(()=>Core.sizePlan(5000,4000,'original',withRedactions(),tiny),/pixel|budget|dimension/i);assert.throws(()=>Core.sizePlan(16384,1,'original',withRedactions({canvasPadding:{...padding,top:0,bottom:0,left:.5,right:0}}),tiny),/range|edge|budget/i);
 const many=Array.from({length:8},(_,i)=>({id:'redaction:'+i,name:'Layer '+i,enabled:true,selection:null,recipe:recipe()}));assert.throws(()=>Core.sizePlan(3000,3000,'original',withRedactions({},many),tiny),/work|budget/i);
 const longStroke=recipe({mode:'mosaic',strokes:Array.from({length:64},()=>({radius:.1,points:Array.from({length:64},(_,i)=>({x:(i%2)*.9,y:i/63}))}))});assert.throws(()=>Core.sizePlan(4096,4096,'original',withRedactions({},[{id:'dense',name:'Dense',enabled:true,selection:null,recipe:longStroke}]),tiny),/work|budget/i);
});
test('64MP source may crop to a valid unselected redaction canvas; selected source raster is independently bounded',()=>{
 const crop={version:1,crop:{x:0,y:0,w:.25,h:.25},quarterTurns:0,flipX:false,flipY:false},s=withRedactions({framing:crop}),p=Core.sizePlan(8000,8000,'original',s);assert.deepEqual([p.processingWidth,p.processingHeight,p.width,p.height],[8000,8000,2000,2000]);
 s.redactions.layers[0].selection=selection();assert.throws(()=>Core.sizePlan(8000,8000,'original',s),/selection|source|pixel|budget/i);assert.doesNotThrow(()=>Core.sizePlan(8000,8000,'working',s));
});
test('invalid/stale/budget recipes fail main preflight before worker launch or text raster access',async()=>{
 const bytes=await png(),base=withRedactions(),bad=structuredClone(base);bad.redactions.sourceRevision='other-source';let spawned=0;class Never{constructor(){spawned++;}}const service=createExportRenderer({WorkerClass:Never});try{await assert.rejects(service.render(request(bytes,bad)),/redaction|source/i);const larger=bytes.slice();new DataView(larger.buffer).setUint32(16,5000);new DataView(larger.buffer).setUint32(20,4000);await assert.rejects(service.render(request(larger,base,{outputSize:{version:1,mode:'long-edge',longEdge:1}})),/pixel|budget/i);assert.equal(spawned,0);}finally{service.dispose();}
});
test('pure cancellation and native cancellation discard output and preserve reusable immutable source',async()=>{
 const im=picture(301,211),before=im.data.slice(),s=withRedactions();let calls=0;assert.throws(()=>Core.processPixels(im,s,analysis,undefined,{shouldCancel:()=>++calls>=3}),error=>error.name==='AbortError');assert.ok(calls>=3);assert.deepEqual(im.data,before);
 const bytes=await png(im),hash=sha(bytes),service=createExportRenderer(),r=request(bytes,s);try{const pending=service.render(r);assert.equal(service.cancel(r.requestId),true);await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(sha(bytes),hash);assert.equal(service.isBusy(),false);const next=await service.render({...r,requestId:'redaction-export:2'});assert.equal(next.width,im.width);}finally{service.dispose();}
});

function browserHarness({redaction=true}={}){
 const workers=[];
 class Canvas{constructor(im=picture(41,29)){this.width=im.width;this.height=im.height;this.data=im.data.slice();this.reads=0;}getContext(){return{getImageData:()=>{this.reads++;return{width:this.width,height:this.height,data:this.data.slice()};},putImageData:im=>{this.data=im.data.slice();}};}}
 class Worker{constructor(){workers.push(this);}postMessage(input){this.input=structuredClone(input);}terminate(){this.terminated=true;}finish(){const i=this.input,result=worker({width:i.width,height:i.height,data:new Uint8ClampedArray(i.buffer)},i.settings,i.analysis);this.onmessage({data:{width:result.width,height:result.height,buffer:result.data.buffer}});}}
 const c=vm.createContext({console,URL,DOMException,structuredClone,queueMicrotask,AbortController,setTimeout,Worker,ImageData:class{constructor(data,width,height){Object.assign(this,{data,width,height});}},document:{createElement:()=>new Canvas()}});
 for(const file of ['geometry.cjs','canvas-padding.cjs','manual-tools.cjs','text-overlay.cjs','text-layers.cjs',...(redaction?['redact-core.cjs','redaction-layers.cjs']:[])])vm.runInContext(fs.readFileSync(require.resolve('../src/'+file),'utf8'),c);
 const source=fs.readFileSync(require.resolve('../src/pipeline.js'),'utf8').replace(/^import .*;$/m,'').replaceAll('import.meta.url',JSON.stringify('mint://app/src/pipeline.js')).replace(/^export /gm,'');vm.runInContext(source+'\nglobalThis.api={render,cancelRenders,lightBalanceInputSettings,DEFAULT_SETTINGS};',c);
 const local=value=>{c.valueJSON=JSON.stringify(value);return vm.runInContext('JSON.parse(valueJSON)',c);};return{api:c.api,Canvas,workers,local};
}
test('browser default worker applies redaction, while explicit defer gives an unredacted base for one final composite',async()=>{
 for(const deferRedactions of [false,true]){const h=browserHarness(),im=picture(),s=withRedactions({framing:frame,canvasPadding:padding}),canvas=new h.Canvas(im),saved=JSON.stringify(s),pending=h.api.render(canvas,h.local(s),h.local(analysis),{deferRedactions});assert.equal(h.workers.length,1);assert.equal(h.workers[0].input.settings.redactions===null,deferRedactions);h.workers[0].finish();const out=await pending,base=Core.processPixels(im,{...s,redactions:null},analysis),expected=deferRedactions?base:Core.processPixels(im,s,analysis);assert.deepEqual(new Uint8ClampedArray(out.data),expected.data);assert.equal(JSON.stringify(s),saved);assert.deepEqual(canvas.data,im.data);}
});
test('browser active text+redaction requires both explicit final-stage flags and cannot run in wrong order',async()=>{
 const s=withRedactions({textLayers:[{id:'text:1',enabled:true,recipe:{...Text.defaults(),text:'Synthetic ID'}}]});
 for(const options of [{},{deferRedactions:true},{deferTextLayers:true}]){const h=browserHarness(),canvas=new h.Canvas();await assert.rejects(h.api.render(canvas,h.local(s),h.local(analysis),options),/文字|遮挡/);assert.equal(h.workers.length,0);assert.equal(canvas.reads,0);}
 const h=browserHarness(),pending=h.api.render(new h.Canvas(),h.local(s),h.local(analysis),{deferTextLayers:true,deferRedactions:true});assert.equal(h.workers[0].input.settings.textLayers.length,0);assert.equal(h.workers[0].input.settings.redactions,null);h.workers[0].finish();await pending;
});
test('browser missing validator, stale source/geometry and over-budget final canvas reject even when deferred',async()=>{
 const s=withRedactions(),bad=browserHarness({redaction:false});await assert.rejects(bad.api.render(new bad.Canvas(),bad.local(s),bad.local(analysis),{deferRedactions:true}),/遮挡组件/);assert.equal(bad.workers.length,0);
 const h=browserHarness();for(const [value,a]of [[{...s,framing:frame},analysis],[s,{...analysis,sourceRevision:'stale'}]])await assert.rejects(h.api.render(new h.Canvas(),h.local(value),h.local(a),{deferRedactions:true}),/source|geometry/i);
 const padded=withRedactions({canvasPadding:{...padding,top:.5,right:.5,bottom:.5,left:.5}}),canvas={width:3000,height:3000,getContext(){throw Error('must preflight before reading');}};await assert.rejects(h.api.render(canvas,h.local(padded),h.local(analysis),{deferRedactions:true}),/budget/i);assert.equal(h.workers.length,0);
});
for(const options of [{sourceView:true},{manualEditing:true}])test('diagnostic source view intentionally excludes final redaction without mutating history '+JSON.stringify(options),async()=>{
 const h=browserHarness(),s=withRedactions({framing:frame,canvasPadding:padding}),before=JSON.stringify(s),pending=h.api.render(new h.Canvas(),h.local(s),h.local(analysis),options);assert.equal(h.workers[0].input.settings.redactions,null);assert.equal(h.workers[0].input.settings.framing,null);assert.equal(h.workers[0].input.settings.canvasPadding,null);h.workers[0].finish();await pending;assert.equal(JSON.stringify(s),before);assert.equal(h.api.lightBalanceInputSettings(h.local(s)).redactions,null);
});
test('browser cancellation with active redaction terminates pending worker and never publishes incomplete pixels',async()=>{
 const h=browserHarness(),controller=new AbortController(),s=withRedactions(),pending=h.api.render(new h.Canvas(),h.local(s),h.local(analysis),{signal:controller.signal});controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(h.workers[0].terminated,true);
 const next=h.api.render(new h.Canvas(),h.local(s),h.local(analysis));h.workers.at(-1).finish();await next;
});
test('browser UMD v11 codec persists redaction recipes and WebCrypto source bytes without Node',async()=>{
 const input=await project();input.photos[0].source.bytes=Array.from(input.photos[0].source.bytes);const c=vm.createContext({crypto:crypto.webcrypto,TextEncoder,TextDecoder,Uint8Array,Uint16Array,Float32Array,ArrayBuffer,DataView,inputJSON:JSON.stringify(input)});
 for(const file of ['geometry.cjs','canvas-padding.cjs','manual-tools.cjs','redact-core.cjs','redaction-layers.cjs','photo-review.cjs','project-document.cjs'])vm.runInContext(fs.readFileSync(require.resolve('../src/'+file),'utf8'),c);
 vm.runInContext('const input=JSON.parse(inputJSON);input.photos[0].source.bytes=Uint8Array.from(input.photos[0].source.bytes);globalThis.output=MintProjectDocument.encode(input).then(bytes=>MintProjectDocument.decode(bytes));',c);const out=await c.output;assert.equal(out.version,P.VERSION);assert.deepEqual(JSON.parse(JSON.stringify(slots(out.photos[0]))),slots(input.photos[0]));
});
