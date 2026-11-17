'use strict';
// Independent synthetic-image audit. NativeCanvas is a raster implementation,
// not an Electron/Windows/browser interaction test. No private images or network.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),sharp=require('sharp');
const R=require('../src/redaction-layers.cjs'),P=require('../src/project-document.cjs'),Core=require('../export-render-core.cjs'),{createExportRenderer}=require('../export-renderer.cjs');
const Geometry=require('../src/geometry.cjs'),Padding=require('../src/canvas-padding.cjs'),Text=require('../src/text-overlay.cjs'),TL=require('../src/text-layers.cjs');
const {Native}=require('../quality/text-qa/native-support.cjs');
const nativeTest=(name,fn)=>test(name,async()=>{assert.ok(Native,'Required QA prerequisite missing: install/restore the documented development-only @napi-rs/canvas 0.1.100 before native acceptance; this is not a production dependency.');await fn();});
const clone=structuredClone,plain=v=>JSON.parse(JSON.stringify(v)),hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const revision='independent:source-1';
function settings(extra={}){return {...clone(P.DEFAULT_SETTINGS),...extra};}
function image(w=53,h=37){return {width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>i%4===3?[0,1,73,128,254,255][Math.floor(i/4)%6]:(Math.floor(i/4)*29+i*73)%256)};}
function recipe(extra={}){return {version:1,mode:'cover',color:'#29a76d',blockSize:.19,strokes:[{radius:.138,points:[{x:.137,y:.29},{x:.843,y:.715}]}],...extra};}
function bind(s,rs=[recipe()],selection=null,rev=revision){s.redactions={version:1,sourceRevision:rev,geometryKey:R.geometryKey(s),layers:rs.map((r,i)=>({id:'independent-'+i,name:'Synthetic layer '+i,enabled:true,recipe:r,selection:clone(selection)}))};return s;}
const context=(s,im)=>({sourceRevision:revision,settings:s,sourceSize:{width:im.width,height:im.height}});
// Deliberately independent scalar oracle: no production mask, rasterizer or planner.
function hit(x,y,w,h,r){return r.strokes.some(st=>{const pts=st.points,rr=(st.radius*Math.min(w,h))**2;for(let n=0;n<Math.max(1,pts.length-1);n++){const a=pts[n],b=pts[Math.min(n+1,pts.length-1)],ax=a.x*(w-1),ay=a.y*(h-1),dx=(b.x-a.x)*(w-1),dy=(b.y-a.y)*(h-1),t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)||0));if((x-ax-dx*t)**2+(y-ay-dy*t)**2<=rr+64*Number.EPSILON*Math.max(1,rr))return true;}return false;});}
function oracle(im,r,select=()=>true){const {width:w,height:h}=im,out=im.data.slice(),rgb=r.color.slice(1).match(/../g).map(v=>parseInt(v,16)),edge=Math.max(1,Math.round(Math.min(w,h)*r.blockSize));for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(!hit(x,y,w,h,r)||!select(x,y))continue;const at=(y*w+x)*4;if(r.mode==='cover'){out.set([...rgb,255],at);continue;}if(im.data[at+3]===0)continue;const sums=[0,0,0];let a=0;for(let sy=Math.floor(y/edge)*edge;sy<Math.min(h,(Math.floor(y/edge)+1)*edge);sy++)for(let sx=Math.floor(x/edge)*edge;sx<Math.min(w,(Math.floor(x/edge)+1)*edge);sx++){const i=(sy*w+sx)*4;a+=im.data[i+3];for(let k=0;k<3;k++)sums[k]+=im.data[i+k]*im.data[i+3];}for(let k=0;k<3;k++)out[at+k]=a?Math.round(sums[k]/a):0;}return {width:w,height:h,data:out};}
async function ready(opts={}){const {harness}=require('../quality/redact-qa/app-harness.cjs');const h=harness(opts);for(let i=0;i<16;i++)await Promise.resolve();h.get('redactRadius').value='15';h.get('redactBlock').value='10';h.get('redactColor').value='#29a76d';h.get('redactUseSelection').checked=true;return h;}
async function armed(opts={},changes={}){const h=await ready(opts),p=h.activate(h.photo('audit',changes));h.api.setTool('redact-cover');for(let i=0;i<16;i++)await Promise.resolve();await h.api.renderCurrent();assert.equal(h.api.redactionFrameReady(),true,h.api.get().renderFailure);return {h,p};}
const point=(h,id=71,x=500,y=350)=>({pointerId:id,button:0,clientX:x,clientY:y,target:h.get('imageSurface')});
function down(h,e=point(h)){h.fire('viewport','pointerdown',e);assert.ok(h.api.redactionState().redactionDraft,h.get('toast').textContent);return e;}
function state(p){return plain({settings:p.settings,undo:p.undo,redo:p.redo,committed:p.committed,revision:p.revision});}
function pixels(c){return c.getContext('2d').getImageData(0,0,c.width,c.height).data;}
async function exported(input){const service=createExportRenderer();try{return await service.render(input);}finally{service.dispose();}}

test('independent scalar oracle proves exact hard-cover RGB/255, untouched outside bytes and source/metadata immutability',()=>{
 for(const [w,h] of [[1,19],[19,1],[53,37],[67,43]]){const im=image(w,h),s=bind(settings()),before=clone({im,s}),actual=R.apply(im,s.redactions,context(s,im)),expected=oracle(im,s.redactions.layers[0].recipe);assert.deepEqual(actual,expected,`${w}x${h}`);assert.deepEqual({im,s},before);assert.notEqual(actual.data,im.data);}
});
test('independent scalar oracle proves source-alpha-weighted mosaic, original alpha and layer order',()=>{
 const im=image(),m=recipe({mode:'mosaic'}),cover=recipe({color:'#ff0017',strokes:[{radius:.09,points:[{x:.5,y:.5}]}]}),s=bind(settings(),[m,cover]),actual=R.apply(im,s.redactions,context(s,im)),expected=oracle(oracle(im,m),cover);assert.deepEqual(actual,expected);assert.notDeepEqual(expected,oracle(oracle(im,cover),m));
 const transparent=image();for(let i=3;i<transparent.data.length;i+=4)transparent.data[i]=0;const only=bind(settings(),[m]);assert.deepEqual(R.apply(transparent,only.redactions,context(only,transparent)),oracle(transparent,m));
});
test('independent coordinate oracle maps binary source selection across all 16 quarter-turn/flip permutations and asymmetric crop/padding',()=>{
 const im=image(59,41),sel={version:1,sourceRevision:revision,base:'none',inverted:false,feather:0,commands:[{kind:'brush',mode:'add',radius:.21,points:[{x:.38,y:.54}]}]};
 for(let q=0;q<4;q++)for(const fx of [false,true])for(const fy of [false,true]){
  const framing={version:1,crop:{x:.12,y:.15,w:.72,h:.7},quarterTurns:q,flipX:fx,flipY:fy},canvasPadding={version:1,top:.13,right:.24,bottom:.07,left:.19,color:'#c85b19',opacity:.25},r=recipe({strokes:[{radius:.5,points:[{x:0,y:.5},{x:1,y:.5}]}]}),s=bind(settings({framing,canvasPadding}),[r],sel),upstream=Padding.apply(Geometry.apply(im,framing),canvasPadding),actual=R.apply(upstream,s.redactions,context(s,im));
  const x0=Math.round(im.width*.12),y0=Math.round(im.height*.15),cw=Math.round(im.width*(.12+.72))-x0,ch=Math.round(im.height*(.15+.7))-y0,gw=q%2?ch:cw,gh=q%2?cw:ch,left=Math.round(Math.min(gw,gh)*.19),top=Math.round(Math.min(gw,gh)*.13),selected=new Set();
  for(let sy=y0;sy<y0+ch;sy++)for(let sx=x0;sx<x0+cw;sx++){if((sx-.38*(im.width-1))**2+(sy-.54*(im.height-1))**2>(.21*Math.min(im.width,im.height))**2+1e-10)continue;const x=sx-x0,y=sy-y0;let ox=q===0?x:q===1?ch-1-y:q===2?cw-1-x:y,oy=q===0?y:q===1?x:q===2?ch-1-y:cw-1-x;if(fx)ox=gw-1-ox;if(fy)oy=gh-1-oy;selected.add(`${ox+left},${oy+top}`);}
  assert.ok(selected.size);assert.deepEqual(actual,oracle(upstream,r,(x,y)=>selected.has(`${x},${y}`)),`${q}/${fx}/${fy}`);
 }
});
test('selected cover refuses feather and selected warp; project and native replay refuse stale binding',()=>{
 const im=image(),sel={version:1,sourceRevision:revision,base:'all',inverted:false,feather:.02,commands:[]},s=bind(settings(),[recipe()],sel);assert.throws(()=>R.apply(im,s.redactions,context(s,im)),/unfeathered|binary/i);
 sel.feather=0;const warped=bind(settings({slim:1}),[recipe()],sel);assert.throws(()=>R.validate(warped.redactions,context(warped,im)),/shape|warp/i);
 for(const alteration of [s=>s.framing={version:1,crop:{x:0,y:0,w:1,h:1},quarterTurns:1,flipX:false,flipY:false},s=>s.redactions.sourceRevision='stale-source']){const s=bind(settings());alteration(s);assert.throws(()=>P.validateSettings(s,{width:im.width,height:im.height},revision),/redaction|geometry|source/i);assert.throws(()=>Core.processPixels(im,s,{sourceRevision:revision,landmarks:[]}),/redaction|geometry|source/i);}
});
nativeTest('production app pointer preview is draft-only; pointerup commits one history item and keeps original intact',async()=>{
 const {h,p}=await armed(),before=state(p),original=pixels(h.api.get().source).slice(),e=down(h);h.fire('viewport','pointermove',{...e,clientX:650});assert.deepEqual(state(p),before);assert.equal(p.settings.redactions,null);h.fire('viewport','pointerup',{...e,clientX:700});assert.equal(p.undo.length,1);assert.equal(p.settings.redactions.layers.length,1);assert.equal(h.api.redactionState().redactionDraft,null);await h.api.renderCurrent();assert.deepEqual(pixels(h.api.get().source),original);assert.deepEqual(pixels(h.api.originalForView()),original);assert.deepEqual(Array.from(pixels(h.api.get().rendered).slice((40*100+50)*4,(40*100+50)*4+4)),[41,167,109,255]);h.api.undo();assert.equal(p.settings.redactions,null);h.api.redo();assert.equal(p.settings.redactions.layers.length,1);
});
for(const reason of ['pointercancel','lostpointercapture','Escape','blur','compare','source-view','stale-recipe','stale-source','undo','pagehide','multipointer'])nativeTest(`production app ${reason} discards an uncommitted stroke`,async()=>{
 const {h,p}=await armed(),before=state(p),e=down(h);
 if(['pointercancel','lostpointercapture'].includes(reason))h.fire('viewport',reason,e);
 else if(reason==='Escape')h.events.get('keydown')({key:'Escape',code:'Escape',target:h.get('viewport'),preventDefault(){}});
 else if(['blur','pagehide'].includes(reason))h.events.get(reason)();
 else if(reason==='compare')h.api.setCompare(true);
 else if(reason==='source-view')h.api.setTool('selection-brush');
 else if(reason==='stale-recipe')p.settings.exposure=12;
 else if(reason==='stale-source')p.sourceRevision='new-source:2';
 else if(reason==='undo')h.api.undo();
 else if(reason==='multipointer'){h.fire('viewport','pointerdown',point(h,72,600));assert.equal(h.api.redactionState().redactionDraft,null);}
 h.fire('viewport','pointerup',e);assert.equal(h.api.redactionState().redactionDraft,null);assert.equal(p.settings.redactions,null);assert.equal(p.undo.length,before.undo.length);assert.equal(p.revision,before.revision);
});
nativeTest('production app snapshots current selection and cannot silently replace it with a later selection',async()=>{
 const sel={version:1,sourceRevision:'audit:source-0',base:'all',inverted:false,feather:0,commands:[]},{h,p}=await armed({}, {manualSelection:sel}),e=down(h);assert.notEqual(h.api.redactionState().redactionDraft.wrapper.layers[0].selection,p.settings.manualSelection);h.fire('viewport','pointerup',e);const saved=plain(p.settings.redactions.layers[0].selection);p.settings.manualSelection.inverted=true;assert.deepEqual(plain(p.settings.redactions.layers[0].selection),saved);
});
nativeTest('production app feathered selected cover refuses even starting a draft, without history changes',async()=>{
 const {h,p}=await armed({}, {manualSelection:{version:1,sourceRevision:'audit:source-0',base:'all',inverted:false,feather:.01,commands:[]}});h.fire('viewport','pointerdown',point(h));assert.equal(h.api.redactionState().redactionDraft,null);assert.equal(p.settings.redactions,null);assert.match(h.get('toast').textContent,/unfeathered|binary/i);assert.equal(p.undo.length,0);
});
nativeTest('production app source inspection is explicitly unredacted and cannot start a cover; returning restores final cover',async()=>{
 const {h,p}=await armed(),e=down(h);h.fire('viewport','pointerup',e);await h.api.renderCurrent();const redacted=pixels(h.api.get().rendered).slice();h.api.setTool('selection-brush');await h.api.renderCurrent();assert.equal(h.api.redactionFrameReady(),false);assert.notDeepEqual(pixels(h.api.get().rendered),redacted);h.api.updateAvailability();assert.match(h.get('redactStatus').textContent,/不显示最终遮盖/);assert.equal(h.api.beginRedactionStroke({...point(h),preventDefault(){}}),false);h.api.setTool('redact-cover');await h.api.renderCurrent();assert.deepEqual(pixels(h.api.get().rendered),redacted);
});
nativeTest('production app sync preserves target-owned redactions and never adds the source cover to an uncovered target',async()=>{
 const {h,p}=await armed(),e=down(h);h.fire('viewport','pointerup',e);const b=h.photo('target-covered'),c=h.photo('target-clear');bind(b.settings,[recipe({color:'#001122'})],null,b.sourceRevision);const owned=plain(b.settings.redactions);h.get('syncScope').value='all';h.fire('applySync');assert.deepEqual(plain(b.settings.redactions),owned);assert.equal(c.settings.redactions,null);assert.notEqual(p.settings.redactions,b.settings.redactions);
});
test('real Sharp PNG/JPEG native composition uses final cover after source effects, crop, padding and text; output resize is last',async()=>{
 const im=image(127,89),bytes=new Uint8Array(await sharp(Buffer.from(im.data),{raw:{width:im.width,height:im.height,channels:4}}).png().toBuffer()),s=bind(settings({exposure:13,framing:{version:1,crop:{x:.1,y:.1,w:.8,h:.8},quarterTurns:1,flipX:true,flipY:false},canvasPadding:{version:1,top:.1,right:.2,bottom:.05,left:.15,color:'#8293a4',opacity:0},textLayers:[{id:'identifier',enabled:true,recipe:{...Text.defaults(),text:'SYNTHETIC-0042'}}]}));
 const plan=Core.sizePlan(im.width,im.height,'original',s),rgba=Uint8Array.from({length:plan.width*plan.height*4},(_,i)=>i%4===3?((Math.floor(i/4)%7===0)?128:0):[251,17,39][i%4]),textOverlay={version:1,requestId:'independent-export',sourceRevision:revision,sourceHash:hash(bytes),recipeHash:hash(TL.canonicalRecipe(s.textLayers)),mode:'original',width:plan.width,height:plan.height,rgba};
 const decoded=await sharp(bytes).autoOrient().withIccProfile('srgb').toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true}),source={width:decoded.info.width,height:decoded.info.height,data:new Uint8ClampedArray(decoded.data)},upstream=Core.processPixels(source,{...s,redactions:null},{sourceRevision:revision,landmarks:[]},textOverlay),expected=oracle(upstream,s.redactions.layers[0].recipe),before=clone({bytes,s,textOverlay});assert.deepEqual(Core.processPixels(source,s,{sourceRevision:revision,landmarks:[]},textOverlay),expected);
 for(const format of ['png','jpeg']){const req={requestId:'independent-export',bytes,sourceRevision:revision,settings:s,analysis:{sourceRevision:revision,landmarks:[]},mode:'original',format,quality:1,textOverlay};for(const resized of [false,true]){const out=await exported({...req,...(resized?{outputSize:{version:1,mode:'long-edge',longEdge:31}}:{})}),meta=await sharp(out.bytes).metadata();assert.equal(meta.exif,undefined);assert.equal(meta.xmp,undefined);assert.equal(meta.iptc,undefined);let raw=Buffer.from(expected.data),w=expected.width,h=expected.height;if(resized){const tmp=await sharp(raw,{raw:{width:w,height:h,channels:4,premultiplied:false}}).resize(out.width,out.height,{fit:'fill',kernel:'lanczos3',withoutEnlargement:true}).raw().toBuffer();raw=tmp;w=out.width;h=out.height;}for(let i=0;i<raw.length;i+=4)if(raw[i+3]===0)raw[i]=raw[i+1]=raw[i+2]=0;if(format==='png'){assert.deepEqual(await sharp(out.bytes).ensureAlpha().raw().toBuffer(),raw);assert.ok(meta.hasAlpha);}else{const encoded=await sharp(raw,{raw:{width:w,height:h,channels:4}}).withIccProfile('srgb').flatten({background:'#ffffff'}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer();assert.deepEqual(Buffer.from(out.bytes),encoded);}}}
 assert.deepEqual({bytes,s,textOverlay},before);
});
nativeTest('production app built-in preset preserves photo-owned cover instead of importing a cover field',async()=>{
 const malicious=bind(settings(),[recipe({color:'#ff00ff'})]).redactions,h=await ready({pipeline:{PRESETS:[{id:'fixture',name:'Fixture',description:'Independent',settings:{exposure:7,redactions:malicious}}]}}),p=h.activate();h.api.setTool('redact-cover');await h.api.renderCurrent();const e=down(h);h.fire('viewport','pointerup',e);const own=plain(p.settings.redactions);h.get('presets').children[0].click();assert.deepEqual(plain(p.settings.redactions),own);assert.equal(p.settings.exposure,7);
});
nativeTest('missing production redaction adapter refuses publishing accepted preview rather than silently uncovering',async()=>{
 const h=await ready({redactionCore:false}),s=bind(settings(),[recipe()],null,'missing:source-0');h.activate(h.photo('missing',s));await h.api.renderCurrent();assert.equal(h.api.get().acceptedRender,null);assert.match(h.api.get().renderFailure,/遮盖组件不可用/);assert.equal(h.api.photos[0].settings.redactions.layers.length,1);
});
nativeTest('actual app export orchestrates NativeCanvas text then Sharp native redaction and ignores in-progress pink guide',async()=>{
 const service=createExportRenderer(),requests=[],results=[];try{const {h,p}=await armed({bridge:{renderExport:async payload=>{requests.push(clone(payload));const out=await service.render(clone(payload));results.push(out);return out;}}},{exposure:9,framing:{version:1,crop:{x:.1,y:.1,w:.8,h:.8},quarterTurns:1,flipX:true,flipY:false},canvasPadding:{version:1,top:.1,right:.2,bottom:.05,left:.15,color:'#334455',opacity:0},textLayers:[{id:'text-audit',enabled:true,recipe:{...Text.defaults(),text:'SYNTHETIC-0042',fontFamily:'mono'}}]});
 const e=down(h);h.fire('viewport','pointerup',e);await h.api.renderCurrent();const committed=plain(p.settings.redactions),original=hash(new Uint8Array(await p.blob.arrayBuffer()));down(h,point(h,79,700,400));await h.api.startExport();assert.equal(requests.length,1,JSON.stringify(h.api.get().exportQueue?.items.map(x=>x.error)));assert.equal(h.calls.writes.length,1);assert.deepEqual(plain(requests[0].settings.redactions),committed);assert.equal(h.api.redactionState().redactionDraft,null);assert.ok(h.calls.nativeTextDraws>0);assert.ok(requests[0].textOverlay);const out=results[0],raw=await sharp(out.bytes).ensureAlpha().raw().toBuffer();const at=(Math.round((out.height-1)*.5)*out.width+Math.round((out.width-1)*.5))*4;assert.deepEqual([...raw.subarray(at,at+4)],[41,167,109,255]);assert.equal(hash(new Uint8Array(await p.blob.arrayBuffer())),original);
 }finally{service.dispose();}
});
