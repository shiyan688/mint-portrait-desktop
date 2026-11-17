'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Size=require('../src/export-size.cjs'),Core=require('../export-render-core.cjs'),Project=require('../src/project-document.cjs'),Text=require('../src/text-overlay.cjs');
const recipe=longEdge=>({version:1,mode:'long-edge',longEdge});
const settings=extra=>({...structuredClone(Project.DEFAULT_SETTINGS),...extra});

test('desktop output planner validates strict own data recipes without reading accessors',()=>{
 assert.deepEqual(Size.defaults(),{version:1,mode:'unchanged',longEdge:null});
 const invalid=[undefined,null,[],false,'unchanged',{},{version:1,mode:'unchanged'},{...Size.defaults(),extra:true},{...Size.defaults(),version:2},{...Size.defaults(),mode:'auto'},{...Size.defaults(),longEdge:0},...[-1,0,1.2,16385,NaN,Infinity,'10',null,undefined,1n].map(recipe)];
 const inherited=Object.assign(Object.create({extra:1}),Size.defaults());invalid.push(inherited);
 const symbol={...Size.defaults(),[Symbol('x')]:1};invalid.push(symbol);
 let reads=0;
 for(const key of ['version','mode','longEdge']){
  const getter=Size.defaults();Object.defineProperty(getter,key,{enumerable:true,get(){reads++;return Size.defaults()[key];}});invalid.push(getter);
  const hidden=Size.defaults();Object.defineProperty(hidden,key,{enumerable:false});invalid.push(hidden);
 }
 for(const value of invalid)assert.throws(()=>Size.validate(value));
 assert.equal(reads,0);assert.deepEqual(Size.validate(Object.assign(Object.create(null),recipe(1))),recipe(1));
 const source=recipe(9),copy=Size.validate(source);source.longEdge=2;assert.equal(copy.longEdge,9);
});

test('mobile shared-domain table confirms integer half-up, portrait/landscape and one-pixel semantics',()=>{
 // Captured by executing mobile export-size.js SHA256
 // 2144c3213ea320a92fb1fd174988f27a0b62cff7e4fcc2647c4cef0b7e5d7e6c.
 // No mobile file/runtime dependency: this source archive remains self-contained.
 const rows=[[1,1,1,1,1],[10,5,5,5,3],[5,10,5,3,5],[7,3,4,4,2],[3,7,4,2,4],
  [6,1,3,3,1],[1,6,3,1,3],[4096,1953,2048,2048,977],[1953,4096,1024,488,1024],
  [3999,1999,2000,2000,1000],[31,31,7,7,7],[16,1,1,1,1],[1,16,1,1,1],[100,99,99,99,98],[99,100,1,1,1]];
 for(const [w,h,n,ow,oh]of rows)assert.deepEqual(Size.plan(w,h,recipe(n)).output,{width:ow,height:oh});
});

test('desktop supports 64MP and16384-edge compositions without importing mobile budgets',()=>{
 assert.equal(Size.LIMITS.maxPixels,64000000);assert.equal(Size.LIMITS.maxEdge,16384);
 assert.deepEqual(Size.plan(8000,8000,recipe(4000)).output,{width:4000,height:4000});
 assert.deepEqual(Size.plan(16384,1,recipe(8192)).output,{width:8192,height:1});
 assert.deepEqual(Size.plan(12000,4000,recipe(6000)).output,{width:6000,height:2000});
 for(const [w,h]of [[8001,8000],[16385,1],[1,16385],[0,1],[1,0],[-1,1],[1.5,2],[NaN,2],[2,Infinity],['3',2]])assert.throws(()=>Size.plan(w,h,recipe(1)));
});

test('all small plans are monotone, never upscale, and honor exact half-up rational arithmetic',()=>{
 for(let w=1;w<=45;w++)for(let h=1;h<=45;h++)for(let n=1;n<=Math.max(w,h);n++){
  const p=Size.plan(w,h,recipe(n)),long=Math.max(w,h),short=Math.min(w,h);
  const expected=Number((2n*BigInt(short)*BigInt(n)+BigInt(long))/(2n*BigInt(long)))||1;
  assert.equal(Math.max(p.output.width,p.output.height),n);assert.equal(Math.min(p.output.width,p.output.height),expected);
  assert.ok(p.output.width<=w&&p.output.height<=h);assert.equal(p.resized,n<long);
 }
 assert.throws(()=>Size.plan(5,10,recipe(11)),/Upscaling/);
});

test('allocation counts only bounded raw stage buffers and identity has no extra allocation',()=>{
 const p=Size.plan(8000,8000,Size.defaults());assert.equal(p.allocation.inputBytes,256000000);assert.equal(p.allocation.outputBytes,256000000);assert.equal(p.allocation.extraBytes,0);assert.equal(p.allocation.pairBytes,512000000);
 const small=Size.plan(8000,8000,recipe(1000));assert.equal(small.allocation.extraBytes,4000000);assert.equal(small.allocation.peakBytes,260000000);assert.ok(small.allocation.pairBytes<=small.allocation.maxPairBytes);
});

test('neutral sizePlan shape remains exact and explicit final plan separates processing/composition/output',()=>{
 const s=settings({canvasPadding:{version:1,top:.1,right:.1,bottom:.1,left:.1,color:'#aabbcc',opacity:1}});
 const legacy=Core.sizePlan(6000,100,'working',s),neutral=Core.sizePlan(6000,100,'working',s,Size.defaults());
 assert.deepEqual(neutral,legacy);assert.equal(Object.hasOwn(neutral,'outputSizePlan'),false);
 const active=Core.sizePlan(6000,100,'working',s,recipe(1000));
 assert.equal(active.processingWidth,4096);assert.equal(active.compositionWidth,legacy.width);assert.equal(active.compositionHeight,legacy.height);assert.equal(active.width,1000);assert.equal(active.scaled,true);assert.equal(active.padded,true);
 assert.deepEqual(active.outputSizePlan,Size.plan(legacy.width,legacy.height,recipe(1000)));
 const equal=Core.sizePlan(6000,100,'working',s,recipe(Math.max(legacy.width,legacy.height)));assert.equal(equal.outputSizePlan.resized,false);assert.equal(equal.width,legacy.width);
 assert.throws(()=>Core.sizePlan(10,5,'original',settings(),undefined));
});

test('tiny output never bypasses source, intermediate padding, complex edit or text composition limits',()=>{
 assert.throws(()=>Core.sizePlan(8001,8000,'original',settings(),recipe(1)),/6400/);
 assert.throws(()=>Core.sizePlan(16385,1,'working',settings(),recipe(1)),/6400/);
 assert.throws(()=>Core.sizePlan(5000,4000,'original',settings({smooth:1}),recipe(1)),/1600/);
 assert.throws(()=>Core.sizePlan(8000,8000,'original',settings({canvasPadding:{version:1,top:.5,right:.5,bottom:.5,left:.5,color:'#ffffff',opacity:1}}),recipe(1)),/budget|limit|pixels|size|尺寸|范围/i);
 const textLayers=[{id:'text',enabled:true,recipe:{...Text.defaults(),text:'X'}}];
 assert.throws(()=>Core.sizePlan(4001,4000,'original',settings({textLayers}),recipe(1)),/文字.*1600/);
 assert.throws(()=>Core.sizePlan(4000,4000,'original',settings({textLayers,canvasPadding:{version:1,top:0,right:0,bottom:.01,left:0,color:'#ffffff',opacity:1}}),recipe(1)),/文字.*1600/);
});

test('browser UMD planner has same behavior without Node or DOM capabilities',()=>{
 const context=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../src/export-size.cjs'),'utf8'),context);
 const result=vm.runInContext('MintExportSize.plan(10,5,{version:1,mode:"long-edge",longEdge:5})',context);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),Size.plan(10,5,recipe(5)));
});
