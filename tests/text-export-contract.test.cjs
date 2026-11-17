'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const Text=require('../src/text-overlay.cjs'),Layers=require('../src/text-layers.cjs'),P=require('../src/project-document.cjs'),Core=require('../export-render-core.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const recipe=extra=>({...Text.defaults(),text:'Mint 薄荷 🧑🏽‍🚀 e\u0301',...extra});
const layer=(extra={})=>({id:'text:1',enabled:true,recipe:recipe(),...extra});
const settings=extra=>({...structuredClone(P.DEFAULT_SETTINGS),...extra});
const source=(w=3,h=2)=>({width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>[201,18,107,0,9,222,91,128,33,88,171,255][i%12])});
function oracle(image,overlay){const out=image.data.slice();for(let i=0;i<out.length;i+=4){const a=overlay.rgba[i+3]/255,b=image.data[i+3]/255;if(a===0)continue;const alpha=a+b*(1-a);for(let c=0;c<3;c++)out[i+c]=Math.round((overlay.rgba[i+c]*a+image.data[i+c]*b*(1-a))/alpha);out[i+3]=Math.round(alpha*255);}return{width:image.width,height:image.height,data:out};}
test('frozen text layout is byte-identical to agreed mobile core and collection defaults are explicit neutral',()=>{
 assert.equal(sha(fs.readFileSync(require.resolve('../src/text-overlay.cjs'))),'44874197cdf371f6763228d61a67c75346c50e37c2267e2b9e69e33f314f93a1');
 assert.deepEqual(P.DEFAULT_SETTINGS.textLayers,[]);assert.equal(Layers.isActive([]),false);assert.equal(Layers.canonicalRecipe([]),'[]');
 assert.equal(Layers.isActive([layer({enabled:false})]),false);assert.equal(Layers.isActive([layer({recipe:recipe({text:''})})]),false);assert.equal(Layers.isActive([layer({recipe:recipe({opacity:0})})]),false);assert.equal(Layers.isActive([layer()]),true);
});
test('layer validation creates independent immutable canonical copies and enforces array order',()=>{
 const input=[layer(),layer({id:'second',recipe:recipe({color:'#ABCDEF'})})],out=Layers.validate(input),before=JSON.stringify(out);
 input[0].recipe.text='Changed';assert.equal(JSON.stringify(out),before);assert.ok(Object.isFrozen(out)&&Object.isFrozen(out[0])&&Object.isFrozen(out[0].recipe));
 assert.throws(()=>{out[0].recipe.text='forbidden';},TypeError);
 const reordered={recipe:{...recipe()},enabled:true,id:'text:1'};assert.equal(Layers.canonicalRecipe([reordered]),Layers.canonicalRecipe([layer()]));
 assert.notEqual(Layers.canonicalRecipe(out),Layers.canonicalRecipe([...out].reverse()));
});
test('invalid, extended, sparse, duplicate, coercible and hostile layer/recipe records fail before getters run',()=>{
 const cases=[null,{},new Array(1),[layer(),layer()],Array.from({length:9},(_,i)=>layer({id:`x${i}`})),[layer({id:'空'})],[layer({id:''})],[layer({id:'constructor'})],[layer({id:'x'.repeat(161)})],[layer({enabled:1})],[layer({unknown:1})],[layer({recipe:{...recipe(),fontFamily:'downloaded-font'}})],[layer({recipe:{...recipe(),text:'x\u0000'}})]];
 const extended=[];extended.extra=true;cases.push(extended);
 const symbol=[layer()];symbol[Symbol('x')]=1;cases.push(symbol);
 const subclass=class extends Array{};cases.push(new subclass(layer()));
 const proto=Object.create({enabled:true});Object.assign(proto,layer());cases.push([proto]);
 let reads=0;const getterLayer=layer();Object.defineProperty(getterLayer,'recipe',{enumerable:true,get(){reads++;return recipe();}});cases.push([getterLayer]);
 const getterRecipe=recipe();Object.defineProperty(getterRecipe,'text',{enumerable:true,get(){reads++;return 'text';}});cases.push([layer({recipe:getterRecipe})]);
 const getterArray=[];Object.defineProperty(getterArray,'0',{enumerable:true,get(){reads++;return layer();}});cases.push(getterArray);
 const hidden=[layer()];Object.defineProperty(hidden,'0',{enumerable:false,value:layer()});cases.push(hidden);
 for(const c of cases)assert.throws(()=>Layers.validate(c));assert.equal(reads,0);
 assert.equal(Layers.validate(Array.from({length:8},(_,i)=>layer({id:`x${i}`,recipe:recipe({text:'x'.repeat(500)})}))).length,8);
});
test('straight-sRGB alpha compositing matches independent oracle and never borrows hidden source RGB',()=>{
 const input=source(),before=input.data.slice(),rgba=new Uint8Array([200,240,70,0,35,190,220,128,18,244,38,255,22,99,143,1,199,77,44,254,123,192,201,66]),overlay={width:3,height:2,rgba},overlayBefore=rgba.slice();
 const out=Layers.composite(input,overlay);assert.deepEqual(out,oracle(input,overlay));assert.deepEqual(input.data,before);assert.deepEqual(rgba,overlayBefore);assert.notEqual(out.data,input.data);
 assert.deepEqual([...out.data.slice(0,4)],[201,18,107,0]);assert.deepEqual([...out.data.slice(12,16)],[22,99,143,1]);
 const transparent={width:3,height:2,rgba:new Uint8Array(24)};assert.deepEqual(Layers.composite(input,transparent),input);
});
test('seeded source-over matches independent integer oracle across full alpha range',()=>{
 const input=source(256,256),rgba=new Uint8Array(input.data.length);let seed=0x46ab19;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>24;};
 for(let i=0;i<rgba.length;i++){rgba[i]=random();input.data[i]=random();}for(let a=0;a<256;a++)for(let b=0;b<256;b++){const i=(a*256+b)*4;rgba[i+3]=a;input.data[i+3]=b;}
 // Exact rational integer reference avoids differing floating operation order.
 const expected=input.data.slice();for(let i=0;i<expected.length;i+=4){const a=BigInt(rgba[i+3]),b=BigInt(input.data[i+3]);if(!a)continue;const den=255n*a+(255n-a)*b;for(let c=0;c<3;c++){const num=255n*a*BigInt(rgba[i+c])+(255n-a)*b*BigInt(input.data[i+c]);expected[i+c]=Number((2n*num+den)/(2n*den));}expected[i+3]=Number((2n*den+255n)/(510n));}
 assert.deepEqual(Layers.composite(input,{width:256,height:256,rgba}).data,expected);
});
test('compositor rejects size/buffer/accessor mismatches before allocating and cancellation keeps originals intact',()=>{
 const input=source(),valid={width:3,height:2,rgba:new Uint8Array(24)},before=input.data.slice();
 for(const bad of [{...valid,width:2},{...valid,rgba:new Uint8Array(23)},{...valid,rgba:new Uint8ClampedArray(24)},{...valid,rgba:new Uint8Array(new SharedArrayBuffer(24))},{...valid,rgba:new(class extends Uint8Array{})(24)},{...valid,extra:true}])assert.throws(()=>Layers.composite(input,bad));
 let reads=0;const rgba=new Uint8Array(24);Object.defineProperty(rgba,'buffer',{get(){reads++;return new ArrayBuffer(24);}});assert.throws(()=>Layers.composite(input,{...valid,rgba}));assert.equal(reads,0);
 const malformed={width:4001,height:4000};Object.defineProperty(malformed,'data',{enumerable:true,get(){reads++;return input.data;}});assert.throws(()=>Layers.composite(malformed,valid));assert.equal(reads,0);
 let checks=0;assert.throws(()=>Layers.composite(input,valid,{shouldCancel:()=>++checks===3}),e=>e.name==='AbortError');assert.deepEqual(input.data,before);
 assert.throws(()=>Layers.composite(input,valid,{shouldCancel:true}));assert.throws(()=>Layers.composite(input,valid,{unknown:()=>false}));
});
test('active text direct pixel replay fails closed without overlay; neutral output stays exact',()=>{
 const input=source(),analysis={landmarks:[],sourceRevision:'source:1'};
 assert.deepEqual(Core.processPixels(input,settings(),analysis),input);
 assert.throws(()=>Core.processPixels(input,settings({textLayers:[layer()]}),analysis),/缺少/);
 assert.throws(()=>Core.processPixels(input,settings(),analysis,{}),/不允许/);
 assert.throws(()=>Core.processPixels(input,settings({textLayers:null}),analysis));
});
test('text16MP final cap is not a new source/complex-processing bypass or a nontext limit',()=>{
 assert.deepEqual([Core.sizePlan(4000,4000,'original',settings({textLayers:[layer()]})).width,Core.sizePlan(4000,4000,'original',settings({textLayers:[layer()]})).height],[4000,4000]);
 assert.throws(()=>Core.sizePlan(4001,4000,'original',settings({textLayers:[layer()]})),/文字.*1600/);
 assert.doesNotThrow(()=>Core.sizePlan(6000,4000,'original',settings()));
 const crop={version:1,crop:{x:0,y:0,w:.1,h:.1},quarterTurns:0,flipX:false,flipY:false};
 assert.doesNotThrow(()=>Core.sizePlan(6000,4000,'original',settings({framing:crop,textLayers:[layer()]})));
 assert.throws(()=>Core.sizePlan(6000,4000,'original',settings({framing:crop,textLayers:[layer()],smooth:1})),/当前人像/);
 assert.throws(()=>Core.sizePlan(8001,8000,'working',settings({framing:crop,textLayers:[layer()]})),/6400/);
 const padding={version:1,top:.5,bottom:.5,left:.5,right:.5,color:'#ffffff',opacity:1};assert.throws(()=>Core.sizePlan(3000,2000,'original',settings({textLayers:[layer()],canvasPadding:padding})),/文字.*1600/);
});
test('UMD text collection has same canonical contract and compositor without Node dependencies',()=>{
 const c=vm.createContext({inputJSON:JSON.stringify([layer()])});for(const file of ['text-overlay.cjs','text-layers.cjs'])vm.runInContext(fs.readFileSync(require.resolve('../src/'+file),'utf8'),c);
 assert.equal(vm.runInContext('MintTextLayers.canonicalRecipe(JSON.parse(inputJSON))',c),Layers.canonicalRecipe([layer()]));
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(Array.from(MintTextLayers.composite({width:1,height:1,data:Uint8ClampedArray.from([255,0,99,0])},{width:1,height:1,rgba:Uint8Array.from([20,100,200,128])}).data))',c)),[20,100,200,128]);
});
