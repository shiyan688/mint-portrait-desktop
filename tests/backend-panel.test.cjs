'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {mount,modelLine}=require('../src/backend-panel.js');
function harness(probe){
 const elements=new Map();class Element{constructor(){this.events={};this.children=[];}addEventListener(name,fn){this.events[name]=fn;}append(child){this.children.push(child);}replaceChildren(){this.children=[];}showModal(){this.open=true;}close(){this.open=false;}}
 const document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();}};
 return {panel:mount(probe?{backendProbe:probe}:null,document),elements};
}
const descriptor={id:'segface',version:'pinned',status:'disabled',reason:'Approval pending',tasks:['parse'],weightsSha256:'a'.repeat(64),license:{id:'MIT',status:'pending'}};
test('model panel honestly reports missing desktop service, never a successful model run',async()=>{
 const h=harness();await h.panel.refresh();assert.match(h.elements.get('backendSummary').textContent,/没有桌面模型服务.*没有运行模型/);
 assert.equal(h.panel.getSelection().modelId,null);
});
test('model panel preserves exact model/hash/license metadata as plain text',()=>{
 const text=modelLine({...descriptor,id:'<img src=x onerror=bad>'});assert.match(text,/<img src=x onerror=bad>/);assert.match(text,/待审核/);assert.ok(text.includes('a'.repeat(64)));
});
test('unavailable CUDA and disabled models are not selected as ready',async()=>{
 const h=harness(async()=>({runtime:{available:true,version:'test-only'},devices:[{kind:'cpu',available:true,name:'CPU'},{kind:'cuda',available:false,name:'CUDA'}],models:[descriptor]}));
 await h.panel.refresh();assert.equal(h.panel.getSelection().device,'cpu');assert.equal(h.panel.getSelection().modelId,null);
 assert.equal(h.elements.get('backendDevice').children[1].disabled,true);assert.equal(h.elements.get('backendModel').disabled,true);
});
test('a late model probe does not replace the newer model status',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);let calls=0;
 const h=harness(()=>++calls===1?pending:Promise.resolve({runtime:{available:false,reason:'New state'},devices:[],models:[]}));
 const old=h.panel.refresh();await h.panel.refresh();resolve({runtime:{available:true,version:'OLD'},devices:[],models:[]});await old;
 assert.match(h.elements.get('backendSummary').textContent,/New state/);assert.doesNotMatch(h.elements.get('backendSummary').textContent,/OLD/);
});
