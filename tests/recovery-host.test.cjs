'use strict';
// Actual main/preload scripts, authored Electron lifecycle only. No native window claim.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events'),{createRequire}=require('node:module');
const ROOT=path.resolve(__dirname,'..'),localRequire=createRequire(path.join(ROOT,'main.cjs'));
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function harness({lock=true,store:provided,showMessage}={}){
 const ipc=new Map(),dirtyEvents=new Map(),app=new EventEmitter(),messages=[],calls={quit:0,ready:0,created:0,storeCreated:0,cancel:0,restore:0,show:0,focus:0,paths:[],operations:[]};let win,rootArgument,response=0,busy=false;
 const store=provided||{status:async()=>({enabled:false}),configure:async payload=>{calls.operations.push(['configure',payload]);return{committed:true};},save:async payload=>{calls.operations.push(['save',payload]);return{committed:true};},open:async payload=>{calls.operations.push(['open',payload]);return{canceled:true};},cancel:()=>{calls.cancel++;return{requested:busy};},isBusy:()=>busy};
 Object.assign(app,{setName(){},requestSingleInstanceLock:()=>lock,whenReady:()=>{calls.ready++;return Promise.resolve();},quit:()=>{calls.quit++;},getPath:name=>{calls.paths.push(name);return path.join(ROOT,'test-user-data');},getVersion:()=> '0.2.3-test',isPackaged:true});
 class BrowserWindow{
  constructor(options){calls.created++;win=this;this.options=options;this.handlers=new Map();this.minimized=false;this.destroyed=false;this.webContents={mainFrame:{url:'mint://app/src/index.html'},setWindowOpenHandler(){},on(){},send(){}};}
  on(name,fn){this.handlers.set(name,fn);}async loadURL(){}isDestroyed(){return this.destroyed;}isMinimized(){return this.minimized;}restore(){calls.restore++;this.minimized=false;}show(){calls.show++;}focus(){calls.focus++;}close(){this.closePromise=this.handlers.get('close')({preventDefault:()=>{this.preventedCascade=true;}});}
 }
 const electron={app,BrowserWindow,dialog:{showMessageBox:async(_win,message)=>{messages.push(message);return showMessage?showMessage(message):{response};}},ipcMain:{handle:(n,f)=>ipc.set(n,f),on:(n,f)=>dirtyEvents.set(n,f)},Menu:{setApplicationMenu(){},buildFromTemplate:x=>x},protocol:{registerSchemesAsPrivileged(){},handle(){}},session:{defaultSession:{webRequest:{onBeforeRequest(){}},setPermissionRequestHandler(){},setPermissionCheckHandler(){}}}};
 const context=vm.createContext({require:name=>name==='electron'?electron:name==='./recovery-store.cjs'?{createRecoveryStore:options=>{calls.storeCreated++;rootArgument=options;return store;}}:localRequire(name),__dirname:ROOT,process,Response,URL,Uint8Array,console});
 vm.runInContext(fs.readFileSync(path.join(ROOT,'main.cjs'),'utf8'),context);await new Promise(r=>setImmediate(r));
 const event=()=>({sender:win.webContents,senderFrame:win.webContents.mainFrame});
 return{app,ipc,store,calls,messages,event,get window(){return win;},get rootArgument(){return rootArgument;},respond:v=>response=v,setBusy:v=>busy=v,dirty:v=>dirtyEvents.get('session:dirty')(event(),v),close:async()=>{let prevented=false;await win.handlers.get('close')({preventDefault(){prevented=true;}});return prevented;}};
}

test('recovery host: a second process quits before ready, windows, IPC or recovery access',async()=>{
 const h=await harness({lock:false});assert.equal(h.calls.quit,1);assert.equal(h.calls.ready,0);assert.equal(h.calls.created,0);assert.equal(h.ipc.size,0);assert.equal(h.calls.storeCreated,0);assert.deepEqual(h.calls.paths,[]);
});
test('recovery host: an existing minimized window is restored/focused, never a second writer',async()=>{
 const h=await harness();h.window.minimized=true;h.app.emit('second-instance');assert.equal(h.calls.restore,1);assert.equal(h.calls.show,1);assert.equal(h.calls.focus,1);assert.equal(h.calls.created,1);assert.equal(h.calls.storeCreated,0);
 h.window.destroyed=true;h.app.emit('second-instance');assert.equal(h.calls.show,1);
});
test('recovery host: all five entry points reject wrong windows/subframes/navigation before creating store',async()=>{
 const h=await harness();for(const name of ['status','configure','save','open','cancel']){
  const invoke=h.ipc.get(`recovery:${name}`);assert.equal(typeof invoke,'function');
  await assert.rejects(invoke({sender:{},senderFrame:{url:'mint://app/src/index.html'}}),/Untrusted/);
  await assert.rejects(invoke({sender:h.window.webContents,senderFrame:{url:'mint://app/src/index.html'}}),/Untrusted/);
  h.window.webContents.mainFrame.url='https://untrusted.invalid/';await assert.rejects(invoke(h.event()),/Untrusted/);h.window.webContents.mainFrame.url='mint://app/src/index.html';
 }assert.equal(h.calls.storeCreated,0);assert.deepEqual(h.calls.paths,[]);
});
test('recovery host: store root is exclusively host userData and validators are the actual project codec',async()=>{
 const h=await harness();await h.ipc.get('recovery:status')(h.event());await h.ipc.get('recovery:status')(h.event());assert.equal(h.calls.storeCreated,1);assert.deepEqual(h.calls.paths,['userData']);
 assert.equal(h.rootArgument.root,path.join(ROOT,'test-user-data','recovery-drafts'));const codec=require('../src/project-document.cjs');assert.equal(h.rootArgument.decode,codec.decode);assert.equal(h.rootArgument.inspectHeader,codec.inspectHeader);
});
test('recovery host: configure/save/open pass their bounded data request to the host validator, not a path grant',async()=>{
 const h=await harness(),settings={enabled:true,budgetMiB:64},snapshot={bytes:new Uint8Array([1,2])},slot={slot:'previous'};
 await h.ipc.get('recovery:configure')(h.event(),settings);await h.ipc.get('recovery:save')(h.event(),snapshot);await h.ipc.get('recovery:open')(h.event(),slot);assert.deepEqual(h.calls.operations,[['configure',settings],['save',snapshot],['open',slot]]);
});
test('recovery host: clean sessions cannot close during writes or cancellation settlement',async()=>{
 const pending=defer();let active=false,cancelRequested=false;
 const h=await harness({store:{status:async()=>({enabled:true}),save:async()=>{active=true;try{return await pending.promise;}finally{active=false;}},isBusy:()=>active,cancel:()=>{cancelRequested=true;return{requested:active};}}});
 const saving=h.ipc.get('recovery:save')(h.event(),{bytes:new Uint8Array(64)});assert.equal(await h.close(),true);assert.match(h.messages.at(-1).message,/恢复草稿正在/);
 await h.ipc.get('recovery:cancel')(h.event());assert.equal(cancelRequested,true);assert.equal(await h.close(),true);
 pending.resolve({committed:false,canceled:true});await saving;assert.equal(await h.close(),false);
});
for(const kind of ['configure','open'])test(`recovery host: ${kind} also blocks close until the store is idle`,async()=>{
 const h=await harness();await h.ipc.get('recovery:status')(h.event());h.setBusy(true);assert.equal(await h.close(),true);assert.match(h.messages.at(-1).title,/恢复草稿/);h.setBusy(false);assert.equal(await h.close(),false);
});
test('recovery host: a canceled quit neither cancels recovery nor disposes it; actual will-quit cancels once',async()=>{
 const h=await harness();await h.ipc.get('recovery:status')(h.event());h.dirty(true);h.app.emit('before-quit');assert.equal(await h.close(),true);assert.equal(h.calls.cancel,0);assert.match(h.messages.at(-1).detail,/不保证包含最近修改/);assert.doesNotMatch(h.messages.at(-1).detail,/本版不会自动保存/);
 h.app.emit('will-quit');assert.equal(h.calls.cancel,1);
});
test('recovery host: accepted clean close rejects any new mutation/open but leaves status and cancellation available',async()=>{
 const h=await harness();assert.equal(await h.close(),false);for(const name of ['save','configure','open'])await assert.rejects(h.ipc.get(`recovery:${name}`)(h.event(),{}),/正在关闭/);assert.equal(h.calls.storeCreated,0);
 await h.ipc.get('recovery:status')(h.event());await h.ipc.get('recovery:cancel')(h.event());assert.equal(h.calls.storeCreated,1);assert.equal(h.calls.cancel,1);
});
test('recovery host: a write that starts during close confirmation still blocks the confirmed close',async()=>{
 let h;h=await harness({showMessage:async message=>{if(message.type==='question'){h.setBusy(true);return{response:1};}return{response:0};}});
 await h.ipc.get('recovery:status')(h.event());h.dirty(true);assert.equal(await h.close(),true);await h.window.closePromise;assert.equal(h.window.preventedCascade,true);assert.match(h.messages.at(-1).message,/恢复草稿正在/);
 await assert.rejects(h.ipc.get('recovery:save')(h.event(),{}),/正在关闭/);h.setBusy(false);assert.equal(await h.close(),false);
});
test('recovery preload: only named frozen capabilities, no renderer path or arbitrary invoke escape',async()=>{
 const calls=[];let api;vm.runInNewContext(fs.readFileSync(path.join(ROOT,'preload.cjs'),'utf8'),{require:name=>{assert.equal(name,'electron');return{contextBridge:{exposeInMainWorld:(key,value)=>{assert.equal(key,'desktop');api=value;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve();},send(){},on(){},removeListener(){}}};}});
 assert.equal(Object.isFrozen(api),true);const payloads=[undefined,{enabled:true,budgetMiB:128},{bytes:new Uint8Array(64)},{slot:'latest'},undefined],names=['recoveryStatus','configureRecovery','saveRecoveryDraft','openRecoveryDraft','cancelRecoveryDraft'],channels=['status','configure','save','open','cancel'];
 for(let i=0;i<names.length;i++){await api[names[i]](payloads[i]);assert.equal(calls[i][0],`recovery:${channels[i]}`);assert.equal(calls[i].length,payloads[i]===undefined?1:2);if(payloads[i]!==undefined)assert.equal(calls[i][1],payloads[i]);}
 assert.equal(api.invoke,undefined);assert.equal(api.readFile,undefined);assert.equal(api.writeFile,undefined);assert.equal(api.setRecoveryPath,undefined);
});
test('recovery packaging: the host store is on the executable and verifier allowlists',()=>{
 assert.ok(require('../tools/package-win.cjs').APP_FILES.includes('recovery-store.cjs'));assert.match(fs.readFileSync(path.join(ROOT,'tools/verify-package.cjs'),'utf8'),/'recovery-store\.cjs'/);
});

for(const outcome of ['uncommitted','committed','uncertain'])test(`recovery host: ${outcome} failure survives IPC as structured data, not lost Error properties`,async()=>{
 const error=Object.assign(new Error('Synthetic storage failure'),{code:'ENOSPC',backupCommitted:true,committed:outcome==='committed',commitUncertain:outcome==='uncertain'});
 const h=await harness({store:{save:async()=>{throw error;},isBusy:()=>false,cancel:()=>({requested:false})}});
 const result=JSON.parse(JSON.stringify(await h.ipc.get('recovery:save')(h.event(),{bytes:new Uint8Array(64)})));
 assert.equal(result.failed,true);assert.equal(result.error,'Synthetic storage failure');assert.equal(result.code,'ENOSPC');assert.equal(result.backupCommitted,true);assert.equal(result.commitUncertain,outcome==='uncertain');assert.equal(result.committed,outcome==='uncertain'?null:outcome==='committed');
});
