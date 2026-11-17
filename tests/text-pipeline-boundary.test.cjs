'use strict';
// Unit scheduling/Canvas doubles plus the real shared cores. No browser was launched.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Padding=require('../src/canvas-padding.cjs');
const Geometry=require('../src/geometry.cjs');
const recipe=extra=>({...Padding.defaults(),top:.3,right:.2,bottom:.1,left:.4,color:'#fedcba',opacity:.5,...extra});
const framing={version:1,crop:{x:.1,y:.2,w:.7,h:.6},quarterTurns:1,flipX:true,flipY:false};
function harness({padding=true,geometry=true,text=true}={}) {
  const workers=[];
  class Canvas {
    constructor(width=9,height=7) {this.width=width;this.height=height;this.reads=0;this.pixels=null;}
    getContext() {return {getImageData:()=>{this.reads++;return{width:this.width,height:this.height,data:this.pixels?.slice()||new Uint8ClampedArray(this.width*this.height*4).fill(33)};},putImageData:im=>{this.pixels=im.data.slice();},fillRect(){},drawImage(){}};}
    toBlob(callback,type) {callback(new Blob([new Uint8Array([1,2,3])],{type}));}
  }
  class Worker {
    constructor(){workers.push(this);}
    postMessage(input){this.input=structuredClone(input);}
    terminate(){this.terminated=true;}
    finish(){const i=this.input;let out={width:i.width,height:i.height,data:new Uint8ClampedArray(i.buffer)};if(i.settings.framing!=null)out=Geometry.apply(out,i.settings.framing);if(i.settings.canvasPadding!=null)out=Padding.apply(out,i.settings.canvasPadding,{maxPixels:16777216,maxEdge:16384});this.onmessage({data:{width:out.width,height:out.height,buffer:out.data.buffer}});}
  }
  const c=vm.createContext({console,URL,DOMException,structuredClone,queueMicrotask,AbortController,setTimeout,Worker,Blob,ImageData:class{constructor(data,width,height){Object.assign(this,{data,width,height});}},document:{createElement:()=>new Canvas()}});
  // Load into the scheduler realm: strict core records deliberately reject foreign
  // object prototypes, so directly injecting a required CommonJS API is not valid.
  if(text)for(const file of ['text-overlay.cjs','text-layers.cjs'])vm.runInContext(fs.readFileSync(require.resolve('../src/'+file),'utf8'),c);
  if(geometry)vm.runInContext(fs.readFileSync(require.resolve('../src/geometry.cjs'),'utf8'),c);
  if(padding)vm.runInContext(fs.readFileSync(require.resolve('../src/canvas-padding.cjs'),'utf8'),c);
  let source=fs.readFileSync(require.resolve('../src/pipeline.js'),'utf8').replace(/^import .*;$/m,'').replaceAll('import.meta.url',JSON.stringify('mint://app/src/pipeline.js')).replace(/^export /gm,'');
  vm.runInContext(source+'\nglobalThis.api={render,cancelRenders,encode,DEFAULT_SETTINGS,PRESETS};',c);
  // Inputs supplied by browser application code live in the same realm.
  const local=value=>{c.valueJSON=JSON.stringify(value);return vm.runInContext('JSON.parse(valueJSON)',c);};
  return {api:c.api,Canvas,workers,local};
}

const Text=require('../src/text-overlay.cjs');
const textRecipe=()=>[{id:'t',enabled:true,recipe:{...Text.defaults(),text:'文字'}}];
test('pixel scheduler refuses active text without explicit final-stage ownership before a worker starts',async()=>{const h=harness(),s=h.local({textLayers:textRecipe()});await assert.rejects(h.api.render(new h.Canvas(),s),/文字必须/);assert.equal(h.workers.length,0);});
test('explicit defer sends only base pixels; saved text is unchanged',async()=>{const h=harness(),s=h.local({textLayers:textRecipe()}),before=JSON.stringify(s),p=h.api.render(new h.Canvas(),s,null,{deferTextLayers:true});assert.deepEqual(Array.from(h.workers[0].input.settings.textLayers),[]);h.workers[0].finish();await p;assert.equal(JSON.stringify(s),before);});
test('missing text validator cannot silently skip active layers even with explicit defer',async()=>{const h=harness({text:false}),s=h.local({textLayers:textRecipe()});await assert.rejects(h.api.render(new h.Canvas(),s,null,{deferTextLayers:true}),/组件/);assert.equal(h.workers.length,0);});
for(const options of [{sourceView:true},{manualEditing:true}])test('source-coordinate view intentionally hides text: '+JSON.stringify(options),async()=>{const h=harness(),s=h.local({textLayers:textRecipe()}),before=JSON.stringify(s),p=h.api.render(new h.Canvas(),s,null,options);assert.equal(h.workers[0].input.settings.textLayers.length,0);h.workers[0].finish();await p;assert.equal(JSON.stringify(s),before);});
test('direct pixel worker rejects a nonempty text recipe rather than claiming a complete export',()=>{let response;const context=vm.createContext({self:{postMessage:r=>response=r}});context.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(require.resolve('../src/'+file),'utf8'),context);};vm.runInContext(fs.readFileSync(require.resolve('../src/pixel-worker.js'),'utf8'),context);context.inputJSON=JSON.stringify({width:1,height:1,settings:{...require('../src/project-document.cjs').DEFAULT_SETTINGS,textLayers:textRecipe()},analysis:{landmarks:[]}});vm.runInContext('const input=JSON.parse(inputJSON);input.buffer=new Uint8ClampedArray([1,2,3,255]).buffer;self.onmessage({data:input});',context);assert.match(response.error,/文字栅格/);assert.equal(response.buffer,undefined);});
