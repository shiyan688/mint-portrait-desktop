'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Native,nativePath,fontRegistrations,fixture}=require('../quality/text-qa/native-support.cjs');
const Text=require('../src/text-overlay.cjs'),Layers=require('../src/text-layers.cjs'),Renderer=require('../src/text-layer-renderer.cjs'),Core=require('../export-render-core.cjs'),Project=require('../src/project-document.cjs');
const {createExportRenderer}=require('../export-renderer.cjs');
const sharp=require('sharp');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const plain=x=>JSON.parse(JSON.stringify(x));
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<500&&!fn();i++)await pause(2);assert.ok(fn(),'asynchronous checkpoint reached');}
const layer=(id='title',recipe={})=>({id,enabled:true,recipe:{...Text.defaults(),text:'薄荷 Mint\n文字排版',...recipe}});
const rgba=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
function rawCanvas(width,height,data){const c=Native.createCanvas(width,height),ctx=c.getContext('2d'),image=ctx.createImageData(width,height);image.data.set(data);ctx.putImageData(image,0,0);return c;}
function sourceOver(base,top){const out=new Uint8ClampedArray(base);for(let i=0;i<out.length;i+=4){const a=top[i+3],b=base[i+3],den=255*a+(255-a)*b;if(a){for(let c=0;c<3;c++)out[i+c]=Math.round((255*a*top[i+c]+(255-a)*b*base[i+c])/den);out[i+3]=Math.round(den/255);}if(out[i+3]===0)out[i]=out[i+1]=out[i+2]=0;}return out;}
async function ready(overrides={}){const{harness}=require('../quality/text-qa/app-harness.cjs');const h=harness(overrides);await until(()=>h.api.get().presetOperation===null);return h;}
const nativeTest=(title,fn)=>test(title,{skip:!Native},fn);
function input(h,id,value){h.get(id).value=String(value);h.fire(id,'input');}

nativeTest('independent real Canvas app: uncommitted drafts never mutate source, history, cache or saved settings',async()=>{
 const h=await ready(),p=h.activate(h.photo('draft',{textLayers:[layer()]}));await h.api.renderCurrent();assert.equal(h.api.get().renderFailure,'');assert.ok(h.calls.nativeTextDraws>0);
 const source=sha(rgba(h.api.get().source)),state=plain({settings:p.settings,undo:p.undo,redo:p.redo,revision:p.revision}),cache=h.api.get().textRasterCache,accepted=h.api.get().acceptedRender;
 input(h,'textContent','未应用 NOT APPLIED');input(h,'textX',22);assert.ok(h.api.get().textDraft);assert.deepEqual(plain({settings:p.settings,undo:p.undo,redo:p.redo,revision:p.revision}),state);assert.equal(sha(rgba(h.api.get().source)),source);assert.equal(h.api.get().textRasterCache,cache);assert.equal(h.api.get().acceptedRender,accepted);
 await h.api.saveProject();const saved=await Project.decode(h.calls.saved[0].bytes);assert.equal(saved.photos[0].settings.textLayers[0].recipe.text,state.settings.textLayers[0].recipe.text);
 h.fire('cancelText');assert.equal(h.api.get().textDraft,null);assert.equal(sha(rgba(h.api.get().source)),source);
});

nativeTest('independent real Canvas app: pending fonts + source replacement cannot publish stale render or cache',async()=>{
 const fonts=defer(),h=await ready({fonts:{ready:fonts.promise}}),p=h.activate(h.photo('first',{textLayers:[layer()]}));const work=h.api.renderCurrent();await until(()=>h.calls.textRasters.length===1);
 assert.equal(h.api.get().acceptedRender,null);assert.equal(h.api.get().textRasterCache,null);const other=h.photo('second');h.activate(other);await h.api.renderCurrent();const accepted=h.api.get().acceptedRender;
 await work;assert.ok(accepted);fonts.resolve();await pause(35);assert.equal(h.api.get().acceptedRender,accepted);assert.equal(h.api.get().textRasterCache,null);assert.equal(h.calls.nativeTextDraws||0,0);assert.equal(p.settings.textLayers.length,1);
});

nativeTest('independent real Canvas app: compositing is atomic and late superseded text cannot replace accepted pixels',async()=>{
 const gate=defer();let block=true;const h=await ready({afterComposite:async()=>{if(block)await gate.promise;}}),p=h.activate(h.photo('atomic',{textLayers:[layer()]}));const work=h.api.renderCurrent();await until(()=>h.calls.textComposites.length===1);
 assert.equal(h.api.get().acceptedRender,null);assert.equal(h.api.get().rendered,null);block=false;h.api.changeSettings({textLayers:[]});await h.api.renderCurrent();const accepted=h.api.get().acceptedRender,hash=sha(rgba(accepted.canvas));gate.resolve();await work;
 assert.equal(h.api.get().acceptedRender,accepted);assert.equal(sha(rgba(h.api.get().rendered)),hash);assert.equal(h.api.get().renderFailure,'');
});

nativeTest('independent real Canvas app: stable basis reuses exact raster, recipe/source/mode invalidate one-entry cache',async()=>{
 const h=await ready(),p=h.activate(h.photo('cache',{textLayers:[layer()]}));await h.api.renderCurrent();assert.equal(h.api.get().renderFailure,'');const initial=h.api.get().textRasterCache;assert.equal(h.calls.textRasters.length,1);
 h.api.changeSettings({exposure:10});await h.api.renderCurrent();assert.equal(h.api.get().textRasterCache,initial);assert.equal(h.calls.textRasters.length,1);
 h.get('exportMode').value='working';h.fire('exportMode','change');await until(()=>h.api.get().acceptedRender&&h.calls.textRasters.length===2);assert.notEqual(h.api.get().textRasterCache,initial);assert.equal(h.calls.textRasters.length,2);const working=h.api.get().textRasterCache;
 h.get('exportMode').value='original';await h.api.renderCurrent();assert.equal(h.calls.textRasters.length,3);assert.notEqual(h.api.get().textRasterCache,working);
 p.sourceRevision+=':changed';await h.api.renderCurrent();assert.equal(h.calls.textRasters.length,4);
 h.api.changeSettings({textLayers:[layer('title',{text:'Another'})]});await h.api.renderCurrent();assert.equal(h.calls.textRasters.length,5);
 p.blob=new Blob([await p.blob.arrayBuffer()],{type:p.blob.type});await h.api.renderCurrent();assert.equal(h.calls.textRasters.length,6,'a distinct Blob cannot reuse prior source cache even with identical bytes/revision');
});

nativeTest('independent real Canvas app: native export reuses accepted raster; cancellation while fonts wait writes nothing',async()=>{
 const requests=[],service=createExportRenderer(),h=await ready({bridge:{renderExport:async request=>{requests.push(request);return service.render(structuredClone(request));},cancelExportRender:id=>service.cancel(id)}});
 try{h.activate(h.photo('native',{textLayers:[layer()]}));await h.api.renderCurrent();const cached=h.api.get().textRasterCache.raster;await h.api.startExport();assert.equal(requests.length,1);assert.equal(h.calls.writes.length,1);assert.equal(h.calls.textEnvelopes[0].preparedRaster,cached);assert.equal(h.calls.textRasters.length,1);assert.equal(requests[0].textOverlay.rgba.length,32000);}finally{service.dispose();}
 const fonts=defer(),cancelled=await ready({fonts:{ready:fonts.promise},bridge:{renderExport:async()=>{throw Error('native export must not be entered');}}});cancelled.activate(cancelled.photo('cancel',{textLayers:[layer()]}));const work=cancelled.api.startExport();await until(()=>cancelled.calls.textEnvelopes.length===1);cancelled.api.cancelExport();await work;fonts.reject(Error('late font failure'));await pause(25);assert.equal(cancelled.calls.writes.length,0);assert.equal(cancelled.api.get().exportRunning,false);
});

nativeTest('independent real Canvas app: cancelled cached export must abort a never-settling recipe digest',async()=>{
 const digest=defer(),entered=defer();const h=await ready({digest:()=>{entered.resolve();return digest.promise;},bridge:{renderExport:async()=>{throw Error('must not enter native export');}}});h.activate(h.photo('hash-cancel',{textLayers:[layer()]}));await h.api.renderCurrent();assert.ok(h.api.get().textRasterCache);let settled=false;const work=h.api.startExport().finally(()=>{settled=true;});await entered.promise;h.api.cancelExport();await pause(60);const cancelledPromptly=settled;
 digest.resolve(await crypto.webcrypto.subtle.digest('SHA-256',new Uint8Array([1])));await work;
 assert.equal(cancelledPromptly,true,'cancel must settle without waiting for an unresponsive digest');assert.equal(h.calls.writes.length,0);
});

nativeTest('independent real Canvas app: source/manual views hide text without moving original-space selection',async()=>{
 const h=await ready(),p=h.activate(h.photo('manual',{textLayers:[layer()],framing:{version:1,crop:{x:.1,y:.1,w:.7,h:.8},quarterTurns:1,flipX:false,flipY:false},canvasPadding:{version:1,top:.1,right:.1,bottom:.1,left:.1,color:'#345678',opacity:1}}));await h.api.renderCurrent();const rendered=sha(rgba(h.api.get().rendered)),count=h.calls.textRasters.length;
 const original=h.api.originalForView();assert.equal(original.width,h.api.get().rendered.width);assert.equal(original.height,h.api.get().rendered.height);assert.notEqual(sha(rgba(original)),rendered,'compare original keeps frame/padding but not text');
 h.api.setTool('selection-brush');await h.api.renderCurrent();assert.equal(h.api.get().renderFailure,'');assert.deepEqual([h.api.get().rendered.width,h.api.get().rendered.height],[100,80]);assert.equal(h.calls.textRasters.length,count);assert.equal(sha(rgba(h.api.get().rendered)),sha(rgba(h.api.get().source)));assert.equal(h.api.get().acceptedRender.mode,'manual-source');
 const q=h.api.manualPoint({clientX:500,clientY:350});assert.equal(q.x,.5);assert.equal(q.y,.5);
 h.api.setTool('pan');await until(()=>h.api.get().acceptedRender?.mode==='framed');assert.equal(sha(rgba(h.api.get().rendered)),rendered);assert.equal(p.settings.textLayers.length,1);
});

nativeTest('independent real Canvas app: partial text draw failure is fail-closed and cannot publish a raster',async()=>{
 let count=0;const h=await ready({textDraw(){if(++count===2)throw Error('injected second-layer draw failure');}});h.activate(h.photo('draw-failure',{textLayers:[layer('one'),layer('two',{color:'#00ff00'})]}));await h.api.renderCurrent();
 assert.equal(h.api.get().acceptedRender,null);assert.equal(h.api.get().rendered,null);assert.equal(h.api.get().textRasterCache,null);assert.match(h.api.get().renderFailure,/second-layer/);assert.equal(h.calls.writes.length,0);
});

nativeTest('independent app/native PNG evidence: real multilingual styled text is final-stage, pixel-exact and source-preserving',async()=>{
 const service=createExportRenderer(),requests=[],results=[],h=await ready({bridge:{renderExport:async r=>{requests.push(r);const out=await service.render(structuredClone(r));results.push(out);return out;},cancelExportRender:id=>service.cancel(id)}});
 try{
  assert.ok(fontRegistrations.some(f=>f.file.includes('CJK')),'CJK evidence needs existing local fonts');const width=900,height=640,source=fixture(width,height),sourceBytes=new Uint8Array(source.toBuffer('image/png'));
  const settings={exposure:8,framing:{version:1,crop:{x:.07,y:.1,w:.82,h:.8},quarterTurns:1,flipX:true,flipY:false},canvasPadding:{version:1,top:.08,right:.1,bottom:.12,left:.1,color:'#172c35',opacity:1},textLayers:[
   layer('title',{text:'薄荷人像\nMINT PORTRAIT',size:.084,y:.28,rotation:-8,lineHeight:1.3,color:'#ffffff',outlineWidth:.05,outlineColor:'#183331',shadow:true}),
   layer('subtitle-back',{text:'可编辑文字\nLayered Type',size:.08,y:.59,rotation:9,color:'#031c25',opacity:.6,fontFamily:'serif',italic:true,shadow:true}),
   layer('subtitle-front',{text:'可编辑文字\nLayered Type',size:.08,x:.49,y:.58,rotation:9,color:'#82efc4',opacity:.9,fontFamily:'serif',italic:true}),
   layer('footer',{text:'2026 / MINT\nCROP • ROTATE • PADDING',size:.036,y:.9,lineHeight:1.5,color:'#c4d8e0',fontFamily:'mono',bold:false})]};
  const p=h.activate(h.photo('visual',settings));p.originalWidth=width;p.originalHeight=height;p.blob=new Blob([sourceBytes],{type:'image/png'});h.api.set({source:h.canvas(width,height)});const before={source:sha(rgba(h.api.get().source)),encoded:sha(sourceBytes),settings:plain(p.settings)};
  await h.api.renderCurrent();assert.equal(h.api.get().renderFailure,'');assert.ok(h.api.get().acceptedRender);const accepted=h.api.get().acceptedRender,raster=h.api.get().textRasterCache.raster;assert.equal(h.calls.nativeTextDraws,4);
  await h.api.startExport();assert.equal(h.calls.writes.length,1,JSON.stringify(h.api.get().exportQueue.items.map(i=>i.error)));assert.equal(requests.length,1);assert.equal(h.calls.textRasters.length,1);assert.equal(h.calls.textEnvelopes[0].preparedRaster,raster);assert.deepEqual(requests[0].textOverlay.rgba,raster.rgba);
  const decoded=await sharp(sourceBytes).autoOrient().withIccProfile('srgb').toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const base=Core.processPixels({width:decoded.info.width,height:decoded.info.height,data:new Uint8ClampedArray(decoded.data)},{...plain(p.settings),textLayers:[]},{landmarks:[],sourceRevision:p.sourceRevision});
  const expected=Layers.composite(base,{width:raster.width,height:raster.height,rgba:raster.rgba});const actual=await sharp(results[0].bytes).ensureAlpha().raw().toBuffer();assert.equal(sha(actual),sha(expected.data),'native decoded pixels equal authoritative composition');const preview=rgba(accepted.canvas),previewDiff={count:0,max:0,total:0};for(let i=0;i<preview.length;i++){const diff=Math.abs(preview[i]-actual[i]);if(diff)previewDiff.count++;previewDiff.max=Math.max(previewDiff.max,diff);previewDiff.total+=diff;}assert.equal(sha(rgba(h.calls.textComposites[0].base)),sha(base.data),'pre-text base parity');
  assert.equal(sha(actual),sha(sourceOver(base.data,raster.rgba)),'independent scalar source-over agrees with authoritative native output');
  const full=rawCanvas(raster.width,raster.height,raster.rgba),scaled=Native.createCanvas(accepted.width,accepted.height),ctx=scaled.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(full,0,0,raster.width,raster.height,0,0,accepted.width,accepted.height);
  const previewOverlay=accepted.width===raster.width&&accepted.height===raster.height?raster.rgba:rgba(scaled);const expectedPreview=rawCanvas(accepted.width,accepted.height,sourceOver(rgba(h.calls.textComposites[0].base),previewOverlay));assert.equal(sha(preview),sha(rgba(expectedPreview)),'real accepted preview matches independent unit-scale/direct or downscaled source-over oracle');assert.equal(sha(preview),sha(actual),'opaque same-size preview skips unnecessary native resampling and equals export');
  const wrongStage=Layers.composite({width:raster.width,height:raster.height,data:new Uint8ClampedArray(raster.width*raster.height*4)},{width:raster.width,height:raster.height,rgba:raster.rgba});assert.notEqual(sha(wrongStage.data),sha(expected.data));
  assert.equal(sha(rgba(h.api.get().source)),before.source);assert.equal(sha(new Uint8Array(await p.blob.arrayBuffer())),before.encoded);assert.deepEqual(plain(p.settings),before.settings);
  const out=path.resolve(__dirname,'../quality/text-qa');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'app-native-final.png'),results[0].bytes);fs.writeFileSync(path.join(out,'app-source.png'),sourceBytes);fs.writeFileSync(path.join(out,'app-accepted-preview.png'),rawCanvas(accepted.width,accepted.height,preview).toBuffer('image/png'));fs.writeFileSync(path.join(out,'app-overlay.png'),await sharp(Buffer.from(raster.rgba),{raw:{width:raster.width,height:raster.height,channels:4}}).png().toBuffer());
  fs.writeFileSync(path.join(out,'app-evidence.json'),JSON.stringify({kind:'synthetic-linux-nativecanvas-shipped-app-native-worker',nativeCanvasPath:nativePath,nativeCanvasVersion:require(path.join(nativePath,'package.json')).version,fonts:fontRegistrations,source:{width,height,sha256:before.encoded,pixelsSHA256:before.source},final:{width:raster.width,height:raster.height,rgbaBytes:raster.rgba.length,pngSHA256:sha(results[0].bytes),decodedRGBA_SHA256:sha(actual),expectedRGBA_SHA256:sha(expected.data),acceptedPreviewRGBA_SHA256:sha(rgba(accepted.canvas)),previewNativeDifference:previewDiff,overlayRGBA_SHA256:sha(raster.rgba)},rendererDraws:h.calls.nativeTextDraws,rasterRequests:h.calls.textRasters.length,nativeExports:requests.length,recipe:plain(p.settings),limitations:['Authored DOM/IPC shell, real shipped app and text cores.','Non-text preview pipeline adapter uses shipped export pixel core.','Installed Linux NativeCanvas and fonts, not Electron/Windows.','No browser, local server, new font/dependency/model/API/photo.','Recipe/source hash binding is association, not glyph attestation or a one-time main token.']},null,2)+'\n');
 }finally{service.dispose();}
});

test('independent budget negatives: tiny typed views cannot disguise >64MB or resizable overlay storage',async()=>{
 const base={width:1,height:1,data:new Uint8ClampedArray([1,2,3,255])};
 const oversized=new Uint8Array(new ArrayBuffer(64000001),1,4);assert.throws(()=>Layers.composite(base,{width:1,height:1,rgba:oversized}),/buffer|backing|storage|budget|缓冲|范围|尺寸|字节|Invalid/i);
 const source=new Uint8Array(await sharp(Buffer.from([1,2,3,255]),{raw:{width:1,height:1,channels:4}}).png().toBuffer()),settings={...structuredClone(Project.DEFAULT_SETTINGS),textLayers:[layer()]};
 const request={requestId:'budget',sourceRevision:'source:budget',bytes:source,settings,analysis:{landmarks:[]},mode:'original',format:'png',quality:1};
 const overlay={version:1,requestId:request.requestId,sourceRevision:request.sourceRevision,sourceHash:sha(source),recipeHash:sha(Layers.canonicalRecipe(settings.textLayers)),mode:'original',width:1,height:1,rgba:oversized};assert.throws(()=>Core.validateRequest({...request,textOverlay:overlay}));
 if(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')){const movable=new Uint8Array(new ArrayBuffer(4,{maxByteLength:16}));assert.throws(()=>Layers.composite(base,{width:1,height:1,rgba:movable}));assert.throws(()=>Core.validateRequest({...request,textOverlay:{...overlay,rgba:movable}}));}
});

nativeTest('independent real Canvas app: pagehide invalidates pending font render before it can repopulate cache',async()=>{
 const fonts=defer(),h=await ready({fonts:{ready:fonts.promise}});h.activate(h.photo('pagehide',{textLayers:[layer()]}));const work=h.api.renderCurrent();await until(()=>h.calls.textRasters.length===1);h.events.get('pagehide')();fonts.resolve();await work;await pause(30);
 assert.equal(h.api.get().acceptedRender,null);assert.equal(h.api.get().textRasterCache,null);assert.equal(h.calls.nativeTextDraws||0,0);
});

test('independent renderer budget: >16MP fails before fonts/allocation and over80MiB encoded backing fails closed',async()=>{
 let fonts=0,canvas=0;const helper=Renderer.create({document:{get fonts(){fonts++;return{ready:new Promise(()=>{})};},createElement(){canvas++;throw Error('must not allocate');}},crypto:crypto.webcrypto,textCore:Text,layersCore:Layers});
 await assert.rejects(helper.raster({layers:[layer()],width:4001,height:4000}),/16,000,000/);assert.equal(fonts,0);assert.equal(canvas,0);
 const oversized=new Uint8Array(new ArrayBuffer(80*1024*1024+1),0,4);await assert.rejects(helper.hashBytes(oversized),/storage/);
});

nativeTest('independent real Canvas app: pagehide cancels pending export font preparation before native submission',async()=>{
 const fonts=defer();let submitted=0;const h=await ready({fonts:{ready:fonts.promise},bridge:{renderExport:async()=>{submitted++;throw Error('must not submit after pagehide');}}});h.activate(h.photo('pagehide-export',{textLayers:[layer()]}));const work=h.api.startExport();await until(()=>h.calls.textEnvelopes.length===1);h.events.get('pagehide')();fonts.resolve();await work;assert.equal(submitted,0);assert.equal(h.calls.writes.length,0);assert.equal(h.api.get().exportRunning,false);
});

nativeTest('independent real Canvas app: different export mode cannot reuse an old prepared raster even at identical dimensions',async()=>{
 const service=createExportRenderer(),h=await ready({bridge:{renderExport:r=>service.render(structuredClone(r)),cancelExportRender:id=>service.cancel(id)}});
 try{h.activate(h.photo('basis-export',{textLayers:[layer()]}));await h.api.renderCurrent();const old=h.api.get().textRasterCache;assert.ok(old);h.get('exportMode').value='working';await h.api.startExport();assert.equal(h.calls.writes.length,1);assert.equal(h.calls.textEnvelopes[0].mode,'working');assert.equal(h.calls.textEnvelopes[0].preparedRaster,undefined);assert.equal(h.calls.nativeTextDraws,2,'new mode rerasterizes rather than reusing previous basis');}finally{service.dispose();}
});

nativeTest('independent real Canvas app: smaller preview scales full-final text pixels rather than laying out text again',async()=>{
 const h=await ready(),p=h.activate(h.photo('downscaled',{textLayers:[layer('cjk',{size:.14,outlineWidth:.04,shadow:true,rotation:13})]}));const bytes=new Uint8Array(fixture(800,640).toBuffer('image/png'));p.blob=new Blob([bytes],{type:'image/png'});p.originalWidth=800;p.originalHeight=640;
 await h.api.renderCurrent();assert.equal(h.api.get().renderFailure,'');const a=h.api.get().acceptedRender,r=h.api.get().textRasterCache.raster;assert.deepEqual([a.width,a.height,r.width,r.height],[100,80,800,640]);assert.equal(h.calls.nativeTextDraws,1);assert.equal(h.calls.textRasters.length,1);
 const full=rawCanvas(r.width,r.height,r.rgba),scaled=Native.createCanvas(a.width,a.height),ctx=scaled.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(full,0,0,r.width,r.height,0,0,a.width,a.height);const expected=rawCanvas(a.width,a.height,sourceOver(rgba(h.calls.textComposites[0].base),rgba(scaled)));assert.equal(sha(rgba(a.canvas)),sha(rgba(expected)));
});

nativeTest('independent actual app/native export: text wholly in bottom padding stays at its final-canvas anchor without content clipping',async()=>{
 const service=createExportRenderer(),requests=[],outputs=[],h=await ready({bridge:{renderExport:async r=>{requests.push(r);const result=await service.render(structuredClone(r));outputs.push(result);return result;},cancelExportRender:id=>service.cancel(id)}});
 try{
  const width=520,height=400,bytes=new Uint8Array(fixture(width,height).toBuffer('image/png'));
  const recipe={...Text.defaults(),text:'留白 MINT',size:.04,y:.95,x:.5,color:'#ffffff',fontFamily:'sans',bold:true,boxWidth:.8};
  const p=h.activate(h.photo('padding-text',{canvasPadding:{version:1,top:0,right:0,bottom:.3,left:0,color:'#172c35',opacity:1},textLayers:[{id:'padding-only',enabled:true,recipe}]}));p.originalWidth=width;p.originalHeight=height;p.blob=new Blob([bytes],{type:'image/png'});h.api.set({source:h.canvas(width,height)});
  await h.api.renderCurrent();assert.equal(h.api.get().renderFailure,'');const accepted=h.api.get().acceptedRender,raster=h.api.get().textRasterCache.raster;assert.deepEqual([raster.width,raster.height],[520,520]);
  const direct=Native.createCanvas(raster.width,raster.height),ctx=direct.getContext('2d'),layout=Text.layout(ctx,raster.width,raster.height,recipe);Text.render(ctx,raster.width,raster.height,recipe);assert.equal(sha(raster.rgba),sha(rgba(direct)),'app never auto-relocates the final-canvas recipe');
  assert.equal(layout.anchor.x,260);assert.equal(layout.anchor.y,494);assert.ok(layout.corners.every(c=>c.y>height&&c.y<raster.height&&c.x>0&&c.x<raster.width),'entire measured text box lies inside bottom padding, not the source-content rect');
  const bounds={left:raster.width,top:raster.height,right:-1,bottom:-1};let alphaPixels=0,contentAlpha=0;
  for(let y=0;y<raster.height;y++)for(let x=0;x<raster.width;x++){if(raster.rgba[(y*raster.width+x)*4+3]){alphaPixels++;if(y<height)contentAlpha++;bounds.left=Math.min(bounds.left,x);bounds.top=Math.min(bounds.top,y);bounds.right=Math.max(bounds.right,x);bounds.bottom=Math.max(bounds.bottom,y);}}
  assert.ok(alphaPixels>100,'native glyphs have nonzero ink in padding');assert.equal(contentAlpha,0);assert.ok(bounds.top>height&&bounds.bottom<raster.height-1,'all actual glyph ink is within padding and away from canvas clipping edges');
  await h.api.startExport();assert.equal(requests.length,1);assert.equal(h.calls.writes.length,1);assert.equal(h.calls.nativeTextDraws,1);assert.equal(h.calls.textEnvelopes[0].preparedRaster,raster);
  const decoded=await sharp(bytes).autoOrient().withIccProfile('srgb').toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});const base=Core.processPixels({width,height,data:new Uint8ClampedArray(decoded.data)},{...plain(p.settings),textLayers:[]},{landmarks:[],sourceRevision:p.sourceRevision});const actual=await sharp(outputs[0].bytes).ensureAlpha().raw().toBuffer();assert.equal(sha(actual),sha(sourceOver(base.data,raster.rgba)));assert.equal(sha(actual),sha(rgba(accepted.canvas)));
  let changedPaddingPixels=0,changedContentPixels=0;for(let y=0;y<raster.height;y++)for(let x=0;x<raster.width;x++){const i=(y*raster.width+x)*4;if(actual[i]!==base.data[i]||actual[i+1]!==base.data[i+1]||actual[i+2]!==base.data[i+2]||actual[i+3]!==base.data[i+3]){if(y<height)changedContentPixels++;else changedPaddingPixels++;}}
  assert.ok(changedPaddingPixels>100,'export preserves visible text outside the source-content rect');assert.equal(changedContentPixels,0,'padding-only text must not alter source-content pixels');assert.equal(p.settings.textLayers[0].recipe.y,.95);assert.equal(p.settings.textLayers[0].recipe.x,.5);
  const dir=path.resolve(__dirname,'../quality/text-qa');fs.writeFileSync(path.join(dir,'padding-placement-final.png'),outputs[0].bytes);fs.writeFileSync(path.join(dir,'padding-placement-overlay.png'),direct.toBuffer('image/png'));fs.writeFileSync(path.join(dir,'padding-placement-evidence.json'),JSON.stringify({kind:'actual-app-native-export-text-entirely-in-bottom-padding',source:{width,height,sha256:sha(bytes)},final:{width:raster.width,height:raster.height,pngSHA256:sha(outputs[0].bytes),decodedRGBA_SHA256:sha(actual),expectedRGBA_SHA256:sha(sourceOver(base.data,raster.rgba))},contentRect:{x:0,y:0,width,height},paddingRect:{x:0,y:400,width:520,height:120},anchor:layout.anchor,measuredCorners:layout.corners,actualInkBounds:bounds,alphaPixels,contentAlpha,changedPaddingPixels,changedContentPixels,recipe:plain(recipe),rasterRequests:h.calls.textRasters.length,textDraws:h.calls.nativeTextDraws,assertions:['All measured bounds and actual nonzero glyph pixels lie wholly in bottom padding.','Export changes padding pixels and zero content pixels.','App raster equals direct shared-core raster at y=0.95; no relocation.','Native decoded pixels match independent scalar source-over and accepted preview.'],qualification:'Synthetic source; installed Linux NativeCanvas and fonts, not Windows/Electron UI.'},null,2)+'\n');
 }finally{service.dispose();}
});
