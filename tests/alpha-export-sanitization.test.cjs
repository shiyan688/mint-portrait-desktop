'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('PNG/WebP encoding zeroes hidden background RGB in export copy only, preserving partial alpha colors',async()=>{
 class Canvas{
  constructor(){this.width=2;this.height=1;this.pixels=new Uint8ClampedArray([200,100,50,0,50,80,120,100]);}
  getContext(){return{getImageData:()=>({data:this.pixels.slice(),width:2,height:1}),putImageData:p=>{this.pixels=p.data.slice();}};}
  toBlob(callback,type){callback(new Blob([this.pixels],{type}));}
 }
 const context=vm.createContext({console,URL,DOMException,Blob,Uint8ClampedArray,Float32Array,document:{createElement:()=>new Canvas()}});
 let source=fs.readFileSync(require.resolve('../src/pipeline.js'),'utf8').replace(/^import .*;$/m,'').replaceAll('import.meta.url',JSON.stringify('mint://app/src/pipeline.js')).replace(/^export /gm,'');
 vm.runInContext(source+'\nglobalThis.api={encode};',context);
 for(const format of ['png','webp']){const canvas=new Canvas(),before=canvas.pixels.slice(),output=await context.api.encode(canvas,format);assert.deepEqual([...output],[0,0,0,0,50,80,120,100]);assert.deepEqual(canvas.pixels,before);}
});
