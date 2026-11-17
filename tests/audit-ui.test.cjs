'use strict';
// Executes the shipped app's JS with deterministic DOM/canvas/IPC stubs.
// It verifies state transitions, not layout, browser APIs, inference, or native dialogs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const defaults={exposure:0,contrast:0,saturation:0,temperature:0,smooth:0,brighten:0,warmth:0,slim:0,eyes:0,nose:0,jaw:0,bgMode:'original',bgBlur:18,bgColor:'#e9eee9',bgFeather:2,spots:[]};
function harness(overrides={}){
 const elements=new Map(),events=new Map(),calls={draw:[],writes:[],dirty:[]};let timer=0;
 const ctx={clearRect(){},drawImage(...a){calls.draw.push(a);},save(){},restore(){},beginPath(){},rect(){},clip(){}};
 class Element{
  constructor(id){this.id=id;this.dataset={};this.style={setProperty(){}};this.classList={toggle(){},add(){},remove(){}};this.value='';this.min='0';this.max='100';this.open=false;this.width=2;this.height=2;this.clientWidth=1000;this.clientHeight=700;this.listeners=new Map();this.children=[];this.parent=null;}
  addEventListener(name,fn){this.listeners.set(name,fn);}setAttribute(){}insertAdjacentHTML(){}append(...children){for(const child of children){child.remove();this.children.push(child);child.parent=this;}}replaceChildren(...children){for(const child of [...this.children])child.remove();this.append(...children);}remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}click(){}focus(){}setPointerCapture(){}matches(){return false;}closest(){return this;}
  querySelector(){return new Element('child');}getContext(){return ctx;}showModal(){this.open=true;}close(){this.open=false;}getBoundingClientRect(){return{left:0,top:0,width:1000,height:700,right:1000,bottom:700};}
 }
 const get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
 get('exportScope').value='all';get('exportFormat').value='png';get('exportQuality').value='94';
 const pipeline={DEFAULT_SETTINGS:defaults,PRESETS:[],initModels:()=>new Promise(()=>{}),decodeImage:async()=>({canvas:{width:20,height:30},originalWidth:20,originalHeight:30}),analyze:async()=>({faceCount:0,landmarks:[],mask:null}),render:async source=>source,encode:async()=>new Uint8Array([137,80,78,71,13,10,26,10]),...overrides.pipeline};
 const bridge={chooseExportFolder:async()=>({token:'test',displayPath:'/chosen'}),writeExport:async payload=>{calls.writes.push(payload);},setSessionDirty:value=>calls.dirty.push(value),onMenuAction:fn=>events.set('menu',fn),...overrides.bridge};
 const context=vm.createContext({Pipeline:pipeline,window:{desktop:bridge,MintExportQueue:require('../src/export-queue.cjs'),addEventListener:(name,fn)=>events.set(name,fn)},document:{getElementById:get,querySelectorAll:()=>[],querySelector:()=>null,createElement:()=>new Element('created'),body:new Element('body')},console,structuredClone,AbortController,URL,Blob,Uint8Array,HTMLElement:Element,crypto:{randomUUID:()=>String(Math.random())},ResizeObserver:class{observe(){}},setTimeout:(fn,delay)=>{if(delay===0)queueMicrotask(fn);return++timer;},clearTimeout(){}});
 let source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8').replace(/^import .*;$/m,'');
 source+='\nglobalThis.audit={photos,renderCurrent,activatePhoto,analyzeCurrent,openImages,startExport,cancelExport,outputDimensions,historyCommit,changeSettings,undo,redo,removeSelected,set:(value)=>{if("source"in value)source=value.source;if("currentId"in value)currentId=value.currentId;if("analysis"in value)analysis=value.analysis;if("modelState"in value)modelState=value.modelState;},get:()=>({source,analysis,rendered,currentId,exportRunning,exportCancelled,loadingPhoto,renderVersion,viewToken})};';
 vm.runInContext(source,context);
 function photo(id='one',settings={}){const p={id,name:`${id}.png`,blob:new Blob(['photo']),thumb:'blob:test',settings:{...structuredClone(defaults),...settings},committed:structuredClone(defaults),undo:[],redo:[],revision:0,selected:true,originalWidth:20,originalHeight:30};context.audit.photos.push(p);return p;}
 return{api:context.audit,photo,elements,calls,events,pipeline,bridge};
}
test('audit: a late render cannot replace a newer edited preview',async()=>{
 const pending=[];const h=harness({pipeline:{render:()=>{const d=defer();pending.push(d);return d.promise;}}});const p=h.photo();h.api.set({source:{width:20,height:30},currentId:p.id});
 const old=h.api.renderCurrent();p.settings.exposure=20;const newer=h.api.renderCurrent();
 const freshCanvas={width:20,height:30,label:'fresh'};pending[1].resolve(freshCanvas);await newer;pending[0].resolve({width:20,height:30,label:'obsolete'});await old;
 assert.equal(h.api.get().rendered,freshCanvas);
});
test('audit: late decoding of an old selection cannot replace the new photo',async()=>{
 const pending=[];const h=harness({pipeline:{decodeImage:()=>{const d=defer();pending.push(d);return d.promise;}}});h.photo('one');h.photo('two');
 const a=h.api.activatePhoto('one'),b=h.api.activatePhoto('two');
 const fresh={width:30,height:40,label:'second'};pending[1].resolve({canvas:fresh,originalWidth:30,originalHeight:40});await b;
 pending[0].resolve({canvas:{width:20,height:30,label:'first'},originalWidth:20,originalHeight:30});await a;
 assert.equal(h.api.get().currentId,'two');assert.equal(h.api.get().source,fresh);
});
test('audit: canceling while folder choice is pending produces no export write',async()=>{
 const folder=defer();const h=harness({bridge:{chooseExportFolder:()=>folder.promise}});h.photo();
 const exportJob=h.api.startExport({preventDefault(){}});h.api.cancelExport();folder.resolve({token:'later',displayPath:'/chosen'});await exportJob;
 assert.equal(h.calls.writes.length,0);assert.equal(h.api.get().exportRunning,false);
});
test('audit: canceling during encoding suppresses the filesystem write',async()=>{
 const encoding=defer(),entered=defer();const h=harness({pipeline:{encode:()=>{entered.resolve();return encoding.promise;}}});h.photo();
 const exportJob=h.api.startExport({preventDefault(){}});await entered.promise;h.api.cancelExport();encoding.resolve(new Uint8Array(8));await exportJob;
 assert.equal(h.calls.writes.length,0);assert.equal(h.api.get().exportRunning,false);
});
test('audit: export settings are a snapshot and repeated submit creates no second write',async()=>{
 const folder=defer(),seen=[];const h=harness({bridge:{chooseExportFolder:()=>folder.promise},pipeline:{render:async(canvas,settings)=>{seen.push(settings);return canvas;}}});const p=h.photo('one',{exposure:12});
 const first=h.api.startExport({preventDefault(){}}),second=h.api.startExport({preventDefault(){}});p.settings.exposure=90;folder.resolve({token:'chosen',displayPath:'/chosen'});await Promise.all([first,second]);
 assert.equal(seen.length,1);assert.equal(seen[0].exposure,12);assert.equal(h.calls.writes.length,1);
});
test('audit: export errors do not leave the session locked',async()=>{
 const h=harness({pipeline:{decodeImage:async()=>{throw new Error('deliberate decoding failure');}}});h.photo();await h.api.startExport({preventDefault(){}});
 assert.equal(h.api.get().exportRunning,false);assert.equal(h.calls.writes.length,0);assert.match(h.elements.get('globalStatus').textContent,/1 张失败/);
});
test('audit: repeated native import requests open only one pending chooser',async()=>{
 const choice=defer();let calls=0;const h=harness({bridge:{openImages:()=>{calls++;return choice.promise;}}});
 const first=h.api.openImages(),second=h.api.openImages();assert.equal(calls,1);choice.resolve([]);await Promise.all([first,second]);
 await h.api.openImages();assert.equal(calls,2);
});
test('audit: native project dirty state remains after successful image export and further edits',async()=>{
 const h=harness();const p=h.photo('one',{exposure:12});h.api.historyCommit(p);assert.equal(h.calls.dirty.at(-1),true);
 await h.api.startExport({preventDefault(){}});assert.equal(h.calls.dirty.at(-1),true);
 h.api.set({source:{width:20,height:30},currentId:p.id});h.api.changeSettings({exposure:25});assert.equal(h.calls.dirty.at(-1),true);
 let veto=false;h.events.get('beforeunload')({preventDefault(){veto=true;}});assert.equal(veto,false,'native close confirmation must not receive a second renderer veto');
});
test('audit: a failed filesystem export retains the unsaved-edit warning',async()=>{
 const h=harness({bridge:{writeExport:async()=>{throw new Error('disk full');}}}),p=h.photo('one',{exposure:12});h.api.historyCommit(p);
 await h.api.startExport({preventDefault(){}});assert.equal(h.calls.dirty.at(-1),true);assert.equal(p.exportedSettings,undefined);
});
test('audit: browser-only sessions retain the beforeunload warning',()=>{
 const h=harness({bridge:{setSessionDirty:undefined}});h.photo('one',{exposure:12});let veto=false;
 const event={preventDefault(){veto=true;}};h.events.get('beforeunload')(event);assert.equal(veto,true);assert.equal(event.returnValue,'');
});
test('audit: undo includes in-progress slider changes and redo restores them',()=>{
 const h=harness(),p=h.photo();h.api.set({source:{width:20,height:30},currentId:p.id});
 h.api.changeSettings({exposure:20},false);h.api.undo();assert.equal(p.settings.exposure,0);h.api.redo();assert.equal(p.settings.exposure,20);
});
test('audit: advertised export dimensions stay within the exact pixel cap after rounding',()=>{
 const h=harness();
 for(const [w,hgt] of [[4096,4096],[4021,3980],[12000,11000],[1,20000]]){
  const out=h.api.outputDimensions(w,hgt);assert.ok(out.width*out.height<=16000000,`${w}×${hgt} -> ${out.width}×${out.height}`);assert.ok(Math.max(out.width,out.height)<=4096);
 }
 assert.equal(h.api.outputDimensions(4021,3980).height,3979);
});
