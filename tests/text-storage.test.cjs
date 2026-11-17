'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Layers=require('../src/text-layers.cjs'),Core=require('../export-render-core.cjs'),P=require('../src/project-document.cjs'),Text=require('../src/text-overlay.cjs'),crypto=require('node:crypto');
const settings={...structuredClone(P.DEFAULT_SETTINGS),textLayers:[{id:'t',enabled:true,recipe:{...Text.defaults(),text:'x'}}]},analysis={landmarks:[],sourceRevision:'source'};const digest=crypto.createHash('sha256').update(Layers.canonicalRecipe(settings.textLayers)).digest('hex');
const rgba=new Uint8Array([1,2,3,255]),image={width:1,height:1,data:rgba};
const envelope=bytes=>({version:1,requestId:'job',sourceRevision:'source',sourceHash:'a'.repeat(64),recipeHash:digest,mode:'original',width:1,height:1,rgba:bytes});
test('text fixed budgets count backing storage, not merely a small subarray view',()=>{const backing=new ArrayBuffer(64000001),view=new Uint8Array(backing,0,4);assert.throws(()=>Layers.composite(image,{width:1,height:1,rgba:view}),/backing/);assert.throws(()=>Core.processPixels(image,settings,analysis,envelope(view)),/64MB/);assert.throws(()=>Layers.composite({width:1,height:1,data:view},{width:1,height:1,rgba}),/backing/);});
test('text rejects growable backing even if current view dimensions match',()=>{const buffer=new ArrayBuffer(4,{maxByteLength:64});assert.equal(buffer.resizable,true);const view=new Uint8Array(buffer,0,4);assert.throws(()=>Layers.composite(image,{width:1,height:1,rgba:view}),/fixed/);assert.throws(()=>Core.processPixels(image,settings,analysis,envelope(view)),/固定/);});
test('text permits ordinary bounded offset views but returns owned output',()=>{const buffer=new Uint8Array(12);buffer.set([99,88,77,255],4);const view=buffer.subarray(4,8),out=Layers.composite(image,{width:1,height:1,rgba:view});assert.deepEqual([...out.data],[99,88,77,255]);assert.notEqual(out.data.buffer,buffer.buffer);const valid=Core.processPixels(image,settings,analysis,envelope(view));assert.equal(valid.data.buffer.byteLength,4);view.fill(0);assert.deepEqual([...valid.data],[99,88,77,255]);});
test('native source envelope rejects oversized or resizable backing before image inspection',()=>{
 const base={requestId:'job',sourceRevision:'source',settings:structuredClone(P.DEFAULT_SETTINGS),analysis,mode:'original',format:'png',quality:.9};
 for(const bytes of [new Uint8Array(new ArrayBuffer(Core.LIMITS.sourceBytes+1),0,4),new Uint8Array(new ArrayBuffer(4,{maxByteLength:32}))])assert.throws(()=>Core.validateRequest({...base,bytes}),/缓冲区必须固定/);
});
