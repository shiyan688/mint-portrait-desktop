'use strict';
// Cloud Node + actual pixel-worker code in a VM, not launched-browser/Windows/GPU QA.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const P=require('../src/perspective.cjs'),G=require('../src/geometry.cjs'),S=require('../src/straighten.cjs'),Padding=require('../src/canvas-padding.cjs'),Sharp=require('../src/sharpness.cjs'),Local=require('../src/local-adjustments.cjs'),Project=require('../src/project-document.cjs'),C=require('../export-render-core.cjs');
const rev='perspective-pipeline:1',analysis={sourceRevision:rev,landmarks:[]},settings=extra=>({...structuredClone(Project.DEFAULT_SETTINGS),perspective:null,...extra});
const recipe=(width=.8,height=.7)=>({version:1,quad:[{x:.1,y:.2},{x:.7,y:.1},{x:.8,y:.7},{x:.2,y:.8}],outputFraction:{width,height}});
const cropRecipe=(x=.25,y=.25,w=.5,h=.5)=>({version:1,quad:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}],outputFraction:{width:w,height:h}});
function picture(width=32,height=24){return{width,height,data:Uint8ClampedArray.from({length:width*height*4},(_,i)=>i%4===3?[0,73,177,255][Math.floor(i/4)%4]:(i*37+Math.floor(i/4)*23)%256)};}
function worker(im,s,overrides={}){
 let result;const c=vm.createContext({raw:Array.from(im.data),w:im.width,h:im.height,json:JSON.stringify(s),facts:JSON.stringify(analysis),extras:JSON.stringify(overrides),self:{postMessage:r=>result=r}});
 c.importScripts=(...names)=>{for(const name of names)vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),c);};
 vm.runInContext(fs.readFileSync(require.resolve('../src/pixel-worker.js'),'utf8'),c);
 vm.runInContext('self.onmessage({data:{width:w,height:h,buffer:Uint8ClampedArray.from(raw).buffer,settings:JSON.parse(json),analysis:JSON.parse(facts),...JSON.parse(extras)}})',c);
 if(result.error)throw Error(result.error);return{...result,data:new Uint8ClampedArray(result.buffer)};
}
const pixels=out=>({width:out.width,height:out.height,data:out.data}),plain=value=>JSON.parse(JSON.stringify(value));
function independentCrop(im,x,y,width,height){const data=new Uint8ClampedArray(width*height*4);for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++)data.set(im.data.subarray(((yy+y)*im.width+xx+x)*4,((yy+y)*im.width+xx+x+1)*4),(yy*width+xx)*4);return{width,height,data};}
// Independent affine edge-coordinate inverse + scalar premultiplied linear-sRGB
// bilinear filter. These fixtures enlarge the selected patch: no mip/N>1 path.
function independentAffine(im,r){
 const width=Math.max(1,Math.round(im.width*r.outputFraction.width)),height=Math.max(1,Math.round(im.height*r.outputFraction.height)),data=new Uint8ClampedArray(width*height*4);
 const q=r.quad,linear=v=>(v/=255)<=.04045?v/12.92:((v+.055)/1.055)**2.4,encode=v=>255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const u=(x+.5)/width,v=(y+.5)/height,sx=(q[0].x+u*(q[1].x-q[0].x)+v*(q[3].x-q[0].x))*im.width-.5,sy=(q[0].y+u*(q[1].y-q[0].y)+v*(q[3].y-q[0].y))*im.height-.5;
  const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy,acc=[0,0,0];let alpha=0;
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const xx=Math.min(im.width-1,Math.max(0,ix+dx)),yy=Math.min(im.height-1,Math.max(0,iy+dy)),j=(yy*im.width+xx)*4,a=(dx?fx:1-fx)*(dy?fy:1-fy)*im.data[j+3];alpha+=a;for(let c=0;c<3;c++)acc[c]+=a*linear(im.data[j+c]);}
  const j=(y*width+x)*4;data[j+3]=Math.round(alpha);if(data[j+3])for(let c=0;c<3;c++)data[j+c]=Math.round(encode(acc[c]/alpha));
 }
 return{width,height,data};
}

test('desktop perspective core is byte-identical frozen mobile UMD',()=>{
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(require.resolve('../src/perspective.cjs'))).digest('hex'),'3a3b57ea8da4ce4a7c99b180a454e9f00a4242a0460621d267ad5487fbe66557');
 const c=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../src/perspective.cjs'),'utf8'),c);assert.equal(c.MintPerspective.version,'1.0.0');
});
test('omission, null and exact neutral preserve all legacy pixel bytes and metadata absence',()=>{
 const im=picture(),before=im.data.slice();for(const value of ['absent',null,P.defaults()]){const s=settings({perspective:value});if(value==='absent')delete s.perspective;
  assert.deepEqual(C.processPixels(im,s,analysis),im);const w=worker(im,s);assert.deepEqual(pixels(w),im);assert.equal(Object.hasOwn(w,'perspectiveReceipt'),false);assert.equal(Object.hasOwn(C.sizePlan(im.width,im.height,'original',s),'perspectiveReceipt'),false);
 }assert.deepEqual(im.data,before);
});
test('integer copy preserves hidden alpha-zero bytes and uses crop edge dimensions independently',()=>{
 const im=picture(),s=settings({perspective:cropRecipe()}),expected=independentCrop(im,8,6,16,12),a=C.processPixels(im,s,analysis),b=worker(im,s);
 assert.deepEqual(a,expected);assert.deepEqual(pixels(b),expected);assert.equal(b.perspectiveReceipt.kind,'copy');assert.equal(b.perspectiveReceipt.resampling,'none');assert.deepEqual(plain(b.perspectiveReceipt),C.sizePlan(32,24,'original',s).perspectiveReceipt);
});
test('nonneutral same-sized rounded copy remains active receipt, not an identity omission',()=>{
 const r={...P.defaults(),outputFraction:{width:.999,height:.999}},s=settings({perspective:r}),im=picture(7,5),out=C.processPixels(im,s,analysis),w=worker(im,s);
 assert.deepEqual(out,im);assert.deepEqual(pixels(w),im);assert.equal(w.perspectiveReceipt.kind,'copy');assert.equal(C.sizePlan(7,5,'original',s).perspectiveReceipt.kind,'copy');
});
for(const [width,height]of [[31,23],[13,29],[17,17]])test(`independent affine pixel-edge/linear-alpha scalar oracle ${width}x${height}`,()=>{
 const im=picture(width,height),r=recipe(1,1),s=settings({perspective:r}),expected=independentAffine(im,r),out=C.processPixels(im,s,analysis),w=worker(im,s);
 assert.deepEqual([out.width,out.height],[width,height]);for(let i=0;i<out.data.length;i++)assert.ok(Math.abs(out.data[i]-expected.data[i])<=1,`byte ${i}`);assert.deepEqual(pixels(w),out);
 assert.equal(w.perspectiveReceipt.inputWidth,width);assert.equal(w.perspectiveReceipt.outputHeight,height);assert.equal(w.perspectiveReceipt.kind,'resample');
});
test('independent integer crop oracle distinguishes correct sharpen→frame→straighten→perspective→padding order',()=>{
 const im=picture(64,48),before=im.data.slice(),s=settings({exposure:7,sharpness:{version:1,amount:75,radius:2,threshold:0},framing:{...G.defaults(),quarterTurns:1,flipX:true},straighten:{version:1,angle:90,mode:'expand'},perspective:cropRecipe(),canvasPadding:{...Padding.defaults(),left:.25,top:.125,color:'#193752'}});
 let beforePerspective=S.apply(G.apply(Sharp.apply(Local.tone(im,s),s.sharpness),s.framing),s.straighten);
 const expected=Padding.apply(independentCrop(beforePerspective,16,12,32,24),s.canvasPadding),actual=C.processPixels(im,s,analysis);
 assert.deepEqual(actual,expected);assert.deepEqual(pixels(worker(im,s)),expected);
 const wrong=independentCrop(Padding.apply(beforePerspective,s.canvasPadding),16,12,32,24);assert.notDeepEqual(actual,wrong);
 const p=C.sizePlan(im.width,im.height,'original',s);assert.deepEqual([p.perspectiveReceipt.inputWidth,p.perspectiveReceipt.inputHeight,p.perspectiveReceipt.outputWidth,p.perspectiveReceipt.outputHeight],[64,48,32,24]);assert.deepEqual([p.width,p.height],[38,27]);assert.deepEqual(im.data,before);
});
test('fractions use the entire post-straighten input, half-up rounding, not quad bounds or original photo',()=>{
 for(const [w,h,angle,f]of [[11,7,90,.5],[11,7,13,.5],[37,23,-13,.7],[41,29,0,Number.MIN_VALUE]]){
  const r={...recipe(),outputFraction:{width:f,height:f}},s=settings({straighten:{version:1,angle,mode:'expand'},perspective:r}),p=C.sizePlan(w,h,'original',s),up=S.plan(w,h,s.straighten).outputSize;
  assert.deepEqual([p.width,p.height],[Math.max(1,Math.round(up.width*f)),Math.max(1,Math.round(up.height*f))]);assert.deepEqual([p.perspectiveReceipt.inputWidth,p.perspectiveReceipt.inputHeight],[up.width,up.height]);
 }
});
test('preview and native never introduce a hidden maxSide intermediate downsize',()=>{
 const im=picture(2001,13),r={...P.defaults(),outputFraction:{width:.75,height:.8}},s=settings({perspective:r});for(const out of [C.processPixels(im,s,analysis),pixels(worker(im,s))])assert.deepEqual([out.width,out.height],[1501,10]);
 const p=C.sizePlan(5000,101,'working',s);assert.equal(p.processingWidth,4096);assert.equal(p.perspectiveReceipt.inputWidth,4096);assert.equal(p.perspectiveReceipt.outputWidth,3072);assert.equal(p.width,3072);
});
test('malformed geometry and strict record attacks fail before callbacks without invoking accessors',()=>{
 let reads=0,polls=0;const base=recipe(),bad=[undefined,{},[],{...base,version:2},{...base,extra:1},{...base,quad:[...base.quad].reverse()},{...base,quad:[base.quad[0],base.quad[2],base.quad[1],base.quad[3]]},{...base,quad:[base.quad[0],base.quad[0],base.quad[2],base.quad[3]]},{...base,outputFraction:{width:0,height:1}},{...base,outputFraction:{width:NaN,height:1}},Object.assign(Object.create({version:1}),{quad:base.quad,outputFraction:base.outputFraction})];
 for(const key of ['quad',Symbol('extra')]){const r=recipe();Object.defineProperty(r,key,{enumerable:true,get(){reads++;return base.quad;}});bad.push(r);}
 for(const perspective of bad){const s=settings({perspective});assert.throws(()=>C.sizePlan(32,24,'original',s));assert.throws(()=>C.processPixels(picture(),s,analysis,undefined,{shouldCancel:()=>{polls++;return false;}}));}
 const s=settings();Object.defineProperty(s,'perspective',{enumerable:true,get(){reads++;return base;}});assert.throws(()=>C.processPixels(picture(),s,analysis));assert.equal(reads,0);assert.equal(polls,0);
});
test('64-million source and upstream expanded limits precede tiny perspective/final outputs',()=>{
 const tiny={...P.defaults(),outputFraction:{width:Number.MIN_VALUE,height:Number.MIN_VALUE}},small={version:1,mode:'long-edge',longEdge:1};
 assert.throws(()=>C.sizePlan(8001,8000,'original',settings({perspective:tiny}),small),/6400/);
 assert.throws(()=>C.sizePlan(8000,8000,'original',settings({straighten:{version:1,angle:.1,mode:'expand'},perspective:tiny}),small),/6400/);
 assert.throws(()=>C.sizePlan(16384,1,'original',settings({straighten:{version:1,angle:1e-20,mode:'expand'},perspective:tiny}),small),/16384|edge/);
 assert.throws(()=>C.sizePlan(8000,8000,'original',settings({perspective:tiny}),small),/memory|budget|512/);
});
test('output+mip bytes join host retained budgets, including backing outside a small source view',()=>{
 const r={...P.defaults(),outputFraction:{width:.25,height:.25}},s=settings({perspective:r}),p=P.plan(320,240,r),base=320*240*8+p.estimates.extraBytes,remaining=512*1024*1024-base;
 assert.ok(p.mipBytes>0);assert.doesNotThrow(()=>C.sizePlan(320,240,'original',s,undefined,{retainedBytes:remaining}));assert.throws(()=>C.sizePlan(320,240,'original',s,undefined,{retainedBytes:remaining+1}),/512/);
 const im=picture(4,4),backing=new ArrayBuffer(32*1024*1024),view=new Uint8ClampedArray(backing,127,im.data.length);view.set(im.data);let polls=0;
 assert.throws(()=>C.processPixels({width:4,height:4,data:view},settings({perspective:recipe()}),analysis,undefined,{retainedBytes:500*1024*1024,shouldCancel:()=>{polls++;return false;}}),/512/);assert.equal(polls,0);assert.deepEqual(view,im.data);
});
test('cancellation at initial/mip/output/final stages never modifies originals or publishes partial result',()=>{
 const im=picture(129,97),before=im.data.slice(),s=settings({perspective:{...P.defaults(),outputFraction:{width:.2,height:.2}}});let total=0;
 C.processPixels(im,s,analysis,undefined,{shouldCancel:()=>{total++;return false;}});assert.ok(total>10);
 for(const stop of [1,3,10,total]){let polls=0;assert.throws(()=>C.processPixels(im,s,analysis,undefined,{shouldCancel:()=>++polls===stop}),e=>e.name==='AbortError');assert.deepEqual(im.data,before);}
});
test('no issued core plan crosses the result boundary, canonical receipt is deeply immutable',()=>{
 const s=settings({perspective:recipe()}),receipt=C.sizePlan(32,24,'original',s).perspectiveReceipt;
 assert.ok(Object.isFrozen(receipt)&&Object.isFrozen(receipt.recipe)&&Object.isFrozen(receipt.recipe.quad));assert.deepEqual(Object.keys(receipt),['version','recipe','inputWidth','inputHeight','outputWidth','outputHeight','kind','resampling']);
 assert.equal(P.mapEdgePoint(receipt,{x:1,y:1},'sourceToOutput'),null);assert.equal(P.mapEdgePoint(structuredClone(P.plan(32,24,s.perspective)),{x:1,y:1},'sourceToOutput'),null);
 s.perspective.quad[0].x=.3;assert.equal(receipt.recipe.quad[0].x,.1);
});
module.exports={picture,recipe,cropRecipe,settings,worker,pixels,independentCrop,independentAffine,analysis,rev};

test('source-space local selection/manual recipe survives active perspective without coordinate or byte mutation',()=>{
 const im=picture(32,24),selection={version:1,sourceRevision:rev,base:'all',inverted:false,feather:0,commands:[]},s=settings({manualSelection:selection,localLayers:[{id:'local',name:'Local selection',enabled:true,opacity:.7,sourceRevision:rev,adjustments:{exposure:11,contrast:0,saturation:0,temperature:0},mask:{kind:'selection',selection}}],perspective:recipe(),canvasPadding:{...Padding.defaults(),top:.2}}),original=structuredClone({im,s});
 const sourceEdited=C.processPixels(im,{...s,perspective:null,canvasPadding:null},analysis),expected=Padding.apply(P.apply(sourceEdited,s.perspective),s.canvasPadding);
 assert.deepEqual(C.processPixels(im,s,analysis),expected);assert.deepEqual(pixels(worker(im,s)),expected);assert.deepEqual({im,s},original);
});
test('selected final paint and cover fail closed even disabled/empty and even same-size perspective copy',()=>{
 const R=require('../src/redaction-layers.cjs'),Paint=require('../src/paint-layers.cjs'),selection={version:1,sourceRevision:rev,base:'all',inverted:false,feather:0,commands:[]};
 for(const perspective of [recipe(),{...P.defaults(),outputFraction:{width:.999,height:.999}}])for(const Module of [R,Paint])for(const enabled of [true,false])for(const empty of [true,false]){
  const s=settings({perspective}),isPaint=Module===Paint,key=isPaint?'paintLayers':'redactions',drawing=isPaint?{version:1,strokes:empty?[]:[{mode:'paint',color:'#123456',width:.1,opacity:1,points:[{x:.2,y:.3}]}]}:{version:1,mode:'cover',color:'#123456',blockSize:.1,strokes:empty?[]:[{radius:.1,points:[{x:.2,y:.3}]}]};
  s[key]={version:1,sourceRevision:rev,geometryKey:Module.geometryKey(s),layers:[{id:'selected',name:'Selected',enabled,selection,recipe:drawing}]};
  assert.throws(()=>C.sizePlan(32,24,'original',s),/perspective/i);assert.throws(()=>C.processPixels(picture(),s,analysis),/perspective/i);
  if(!isPaint)assert.throws(()=>worker(picture(),s),/perspective/i);
 }
});
test('exact-neutral perspective never invalidates legacy selected cover binding or scalar-copy mask transport',()=>{
 const R=require('../src/redaction-layers.cjs'),selection={version:1,sourceRevision:rev,base:'all',inverted:false,feather:0,commands:[]},base=settings(),redactions={version:1,sourceRevision:rev,geometryKey:R.geometryKey(base),layers:[{id:'selected',name:'Selected',enabled:true,selection,recipe:{version:1,mode:'cover',color:'#123456',blockSize:.1,strokes:[{radius:.15,points:[{x:.5,y:.5}]}]}}]};
 const expected=C.processPixels(picture(),{...base,redactions},analysis);for(const perspective of [null,P.defaults()]){const s={...base,redactions,perspective};assert.equal(R.geometryKey(s),redactions.geometryKey);assert.deepEqual(C.processPixels(picture(),s,analysis),expected);assert.deepEqual(pixels(worker(picture(),s)),expected);}
});

test('bounded perspective work rejects before pixels even when source and output memory fit and final file is tiny',()=>{
 const r={version:1,quad:[{x:0,y:0},{x:1,y:0},{x:.6,y:1},{x:.4,y:1}],outputFraction:{width:1,height:1}},s=settings({perspective:r});
 const small=P.plan(1000,1000,r);assert.equal(small.workUnits,57250000);assert.ok(small.estimatedBytes<16*1024*1024);
 // At 3000², 56 taps/output pixel alone exceeds 256 Mi work units, while
 // source+output+two mip levels are only 117 MB. Downsize cannot pardon it.
 assert.throws(()=>C.sizePlan(3000,3000,'original',s,{version:1,mode:'long-edge',longEdge:1}),/work budget/);
});

test('learned alpha and source landmarks remain byte/coordinate unchanged while completed raster is rectified',()=>{
 const im=picture(32,24),mask=Float32Array.from({length:32*24},(_,i)=>(i%32)/31),facts={sourceRevision:rev,landmarks:[Array.from({length:468},(_,i)=>({x:.5+.2*Math.cos(i),y:.5+.2*Math.sin(i),z:0}))],mask:{width:32,height:24,data:mask,maxValue:1,space:'working-pixels',learnedMatteId:'matte:1'},learnedMatte:{cacheId:'matte:1',sourceRevision:rev,originalSize:{width:32,height:24},provenance:{kind:'model',task:'matting',modelId:'existing-local-model',weightsSha256:'1'.repeat(64)}}},s=settings({bgMode:'color',bgColor:'#203d51',learnedMatteId:'matte:1',perspective:recipe()}),before=structuredClone({im,s,facts});
 const sourceEdited=C.processPixels(im,{...s,perspective:null},facts),expected=P.apply(sourceEdited,s.perspective);assert.deepEqual(C.processPixels(im,s,facts),expected);
 let result;const c=vm.createContext({raw:Array.from(im.data),maskRaw:Array.from(mask),json:JSON.stringify(s),facts:JSON.stringify({...facts,mask:{...facts.mask,data:null}}),self:{postMessage:r=>result=r}});c.importScripts=(...names)=>{for(const name of names)vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),c);};vm.runInContext(fs.readFileSync(require.resolve('../src/pixel-worker.js'),'utf8'),c);vm.runInContext('const a=JSON.parse(facts);a.mask.data=Float32Array.from(maskRaw);self.onmessage({data:{width:32,height:24,buffer:Uint8ClampedArray.from(raw).buffer,settings:JSON.parse(json),analysis:a}})',c);
 assert.equal(result.error,undefined);assert.deepEqual(new Uint8ClampedArray(result.buffer),expected.data);assert.deepEqual({im,s,facts},before);assert.deepEqual(vm.runInContext('Array.from(a.mask.data)',c).join(','),Array.from(mask).join(','));
});
