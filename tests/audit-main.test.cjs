'use strict';
// Main-process boundary tests with Electron mocked. No native window is launched.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
async function harness(){
 const ipc=new Map(),events=new Map(),openResults=[],calls={stat:[],read:[],write:[]};let window,protocolHandler,networkHandler,permissions;
 const fakeFs={stat:async p=>{calls.stat.push(p);return{isFile:()=>true,size:12};},readFile:async p=>{calls.read.push(p);return Buffer.from([137,80,78,71,13,10,26,10]);}};
 class BrowserWindow{constructor(options){this.options=options;window=this;this.handlers={};this.webContents={mainFrame:{url:'mint://app/src/index.html'},setWindowOpenHandler:fn=>this.openHandler=fn,on:(event,fn)=>this.handlers[event]=fn,send:()=>{}};}on(event,fn){this.handlers[event]=fn;}async loadURL(url){this.loaded=url;}close(){}}
 const electron={
  app:{setName:()=>{},requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),isPackaged:true,getVersion:()=> '0.1.0',on:()=>{},quit:()=>{}},BrowserWindow,
  dialog:{showOpenDialog:async()=>openResults.shift(),showMessageBox:async()=>({response:0})},
  ipcMain:{handle:(name,fn)=>ipc.set(name,fn),on:(name,fn)=>events.set(name,fn)},
  Menu:{setApplicationMenu:()=>{},buildFromTemplate:items=>items},
  protocol:{registerSchemesAsPrivileged:()=>{},handle:(scheme,fn)=>{assert.equal(scheme,'mint');protocolHandler=fn;}},
  session:{defaultSession:{webRequest:{onBeforeRequest:fn=>networkHandler=fn},setPermissionRequestHandler:fn=>permissions=fn,setPermissionCheckHandler:()=>{}}}
 };
 const core=require('../desktop-core.cjs');
 const context=vm.createContext({require:name=>name==='electron'?electron:name==='node:fs/promises'?fakeFs:name==='./desktop-core.cjs'?{...core,writeUniqueImage:async(...args)=>{calls.write.push(args);return{filename:args[1]};}}:require(name),__dirname:path.resolve(__dirname,'..'),process,Response,URL,Uint8Array,console});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 const event=()=>({sender:window.webContents,senderFrame:window.webContents.mainFrame});
 return{ipc,events,window,event,openResults,calls,fakeFs,protocolHandler,networkHandler,getPermissions:()=>permissions};
}
test('audit: all invoke IPC methods reject other windows and subframes',async()=>{
 const h=await harness();assert.ok(h.ipc.size>=4);
 for(const handler of h.ipc.values()){
  await assert.rejects(handler({sender:{},senderFrame:{url:'mint://app/src/index.html'}}),/Untrusted/);
  await assert.rejects(handler({sender:h.window.webContents,senderFrame:{url:'mint://app/src/index.html'}}),/Untrusted/);
 }
});
test('audit: main rejects external network and unexpected permissions',async()=>{
 const h=await harness();
 for(const url of ['https://example.com/photo','http://127.0.0.1/','file:///private/photo.jpg','ftp://example.com/a']){let r;h.networkHandler({url},v=>r=v);assert.equal(r.cancel,true);}
 for(const url of ['mint://app/assets/demo.png','blob:mint://app/photo','data:image/png,abc']){let r;h.networkHandler({url},v=>r=v);assert.equal(r.cancel,false);}
 let permission;h.getPermissions()({},'camera',value=>permission=value);assert.equal(permission,false);
 assert.equal(h.window.options.webPreferences.contextIsolation,true);assert.equal(h.window.options.webPreferences.nodeIntegration,false);assert.equal(h.window.options.webPreferences.sandbox,true);
 assert.equal(h.window.openHandler({url:'https://example.com'}).action,'deny');
});
test('audit: canceling import performs no filesystem read',async()=>{
 const h=await harness();h.openResults.push({canceled:true,filePaths:[]});
 assert.equal((await h.ipc.get('images:open')(h.event())).length,0);assert.equal(h.calls.stat.length,0);assert.equal(h.calls.read.length,0);
});
test('audit: import limits are checked before image bytes are read',async()=>{
 const h=await harness();h.openResults.push({canceled:false,filePaths:Array(101).fill('/a.jpg')});
 await assert.rejects(h.ipc.get('images:open')(h.event()),/100/);assert.equal(h.calls.stat.length,0);
 h.fakeFs.stat=async()=>({isFile:()=>true,size:81*1024*1024});h.openResults.push({canceled:false,filePaths:['/a.jpg']});
 await assert.rejects(h.ipc.get('images:open')(h.event()),/80 MB/);assert.equal(h.calls.read.length,0);
});
test('audit: export grants are opaque; new folder revokes previous grant',async()=>{
 const h=await harness(),choose=h.ipc.get('export:choose-folder'),write=h.ipc.get('export:write');
 h.openResults.push({canceled:false,filePaths:['/one']});const a=await choose(h.event());
 await write(h.event(),{folderToken:a.token,name:'edited.png',bytes:new Uint8Array(8)});assert.equal(h.calls.write[0][0],'/one');
 h.openResults.push({canceled:false,filePaths:['/two']});const b=await choose(h.event());assert.notEqual(a.token,b.token);
 await assert.rejects(write(h.event(),{folderToken:a.token,name:'edited.png',bytes:new Uint8Array(8)}),/重新选择/);
 await assert.rejects(write(h.event(),{folderToken:'/two',name:'edited.png',bytes:new Uint8Array(8)}),/重新选择/);
 h.openResults.push({canceled:true,filePaths:[]});assert.equal(await choose(h.event()),null);
 assert.equal(h.calls.write.length,1);
});
test('audit: combined import limit and non-files reject before reading',async()=>{
 const h=await harness(),open=h.ipc.get('images:open');
 h.fakeFs.stat=async()=>({isFile:()=>true,size:70*1024*1024});h.openResults.push({canceled:false,filePaths:['a.jpg','b.jpg','c.jpg','d.jpg','e.jpg','f.jpg']});
 await assert.rejects(open(h.event()),/400 MB/);assert.equal(h.calls.read.length,0);
 h.fakeFs.stat=async()=>({isFile:()=>false,size:0});h.openResults.push({canceled:false,filePaths:['folder.jpg']});
 await assert.rejects(open(h.event()),/80 MB/);assert.equal(h.calls.read.length,0);
});
