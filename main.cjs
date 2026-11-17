'use strict';
const {app,BrowserWindow,dialog,ipcMain,Menu,protocol,session}=require('electron');
const path=require('node:path'),fs=require('node:fs/promises'),crypto=require('node:crypto');
const {assetPath,writeUniqueImage,MAX_FILE_BYTES,MAX_IMPORT_BYTES}=require('./desktop-core.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'mint',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
app.setName('薄荷人像');
// Recovery generations have a single writer for this application/user-data profile.
const ownsInstance=app.requestSingleInstanceLock();
if(!ownsInstance) app.quit();
let win,dirty=false,closing=false,closePrompt=false,importDialogActive=false,folderTokens=new Map();
let imageImports=null;
function imageImportService(){if(!imageImports){const codec=require('./src/image-assets.cjs').createCodec({overlay:require('./src/image-overlay.cjs')});imageImports=require('./image-import.cjs').createImageImportService({dialog,getWindow:()=>win,codec,inspectImage:require('./src/project-document.cjs').inspectImage});}return imageImports;}
let portraitBackend=null, projectFiles=null, exportRenderer=null, activeExportWrites=0, presetFiles=null, recoveryFiles=null;
function exportsService(){ if(!exportRenderer) exportRenderer=require('./export-renderer.cjs').createExportRenderer(); return exportRenderer; }
function projects(){
 if(!projectFiles){const {createProjectStore}=require('./project-store.cjs');const codec=require('./src/project-document.cjs');projectFiles=createProjectStore({dialog,getWindow:()=>win,decode:codec.decode,inspectHeader:codec.inspectHeader,maxBytes:codec.MAX_CONTAINER_BYTES||codec.LIMITS.MAX_CONTAINER_BYTES});}
 return projectFiles;
}
function presets(){
 if(!presetFiles){const codec=require('./src/preset-codec.cjs').createCodec({advancedTone:require('./src/advanced-tone.cjs'),levels:require('./src/levels.cjs'),lightBalance:require('./src/light-balance.cjs')});presetFiles=require('./preset-store.cjs').createPresetStore({root:path.join(app.getPath('userData'),'adjustment-presets'),dialog,getWindow:()=>win,codec});}
 return presetFiles;
}
function recovery(){
 if(!recoveryFiles){const codec=require('./src/project-document.cjs');recoveryFiles=require('./recovery-store.cjs').createRecoveryStore({root:path.join(app.getPath('userData'),'recovery-drafts'),decode:codec.decode,inspectHeader:codec.inspectHeader});}
 return recoveryFiles;
}
function recoveryAction(method,payload){
 if(closing) throw new Error('应用正在关闭，未开始新的恢复操作。');
 return recovery()[method](payload);
}
async function saveRecovery(payload){
 if(closing) throw new Error('应用正在关闭，未开始新的恢复操作。');
 try{return await recovery().save(payload);}
 catch(error){
  // Electron does not reliably preserve custom Error properties over invoke.
  // Keep commit uncertainty and partial backup commits explicit data, not guesses.
  const uncertain=error?.commitUncertain===true;
  return {canceled:false,failed:true,committed:uncertain?null:error?.committed===true,
   backupCommitted:error?.backupCommitted===true,commitUncertain:uncertain,
   code:typeof error?.code==='string'?error.code.slice(0,80):'RECOVERY_FAILED',
   error:String(error?.message||'本地恢复操作失败').slice(0,2000)};
 }
}
function backend(){
 if(!portraitBackend){const {createDesktopAI}=require('./desktop-ai.cjs');portraitBackend=createDesktopAI({root:__dirname,platform:process.platform,packaged:app.isPackaged,resourcesPath:process.resourcesPath||__dirname});}
 return portraitBackend;
}
const APP_URL='mint://app/src/index.html';
function trusted(e){if(!win||e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame||e.senderFrame.url!==APP_URL)throw new Error('Untrusted IPC sender');}
function handle(name,fn){ipcMain.handle(name,async(e,...args)=>{trusted(e);return fn(...args);});}
function action(name){win?.webContents.send('menu:action',name);}
async function createWindow(){
 win=new BrowserWindow({width:1540,height:980,minWidth:1100,minHeight:720,backgroundColor:'#111816',title:'薄荷人像 · Desktop',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,spellcheck:false,devTools:!app.isPackaged}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(e,url)=>{if(url!==APP_URL)e.preventDefault();});
 win.webContents.on('will-attach-webview',e=>e.preventDefault());
 win.on('close',async e=>{
  imageImports?.cancel();
  if(projectFiles?.isBusy()||presetFiles?.isBusy()||recoveryFiles?.isBusy()||exportRenderer?.isBusy()||activeExportWrites>0){
   e.preventDefault();
   if(!closePrompt){
    closePrompt=true;
    try{await dialog.showMessageBox(win,{type:'info',title:recoveryFiles?.isBusy()?'恢复草稿操作进行中':presetFiles?.isBusy()?'预设操作进行中':projectFiles?.isBusy()?'工程操作进行中':'导出进行中',message:recoveryFiles?.isBusy()?'恢复草稿正在校验或写入。请等待完成，或在“恢复草稿”中取消写入后再关闭。':presetFiles?.isBusy()?'请等待预设保存或文件对话框结束后再关闭。':projectFiles?.isBusy()?'请等待工程操作结束后再关闭，以免中断保存。':activeExportWrites>0?'正在提交导出文件。请等待保存结束后再关闭，避免中断写入。':'请先在导出队列中停止处理，或等待导出结束后再关闭。'});}
    finally{closePrompt=false;}
   }
   return;
  }
  if(!dirty||closing){closing=true;return;}e.preventDefault();if(closePrompt)return;closePrompt=true;const r=await dialog.showMessageBox(win,{type:'question',buttons:['继续编辑','关闭'],defaultId:0,cancelId:0,title:'结束本次编辑？',message:'尚未保存到工程的会话内容将丢失。原始照片不会被修改。',detail:'请先使用“保存工程”保存照片、调整、历史和蒙版。可选本机恢复草稿不等同于正式保存，也不保证包含最近修改；请在“恢复草稿”中查看状态。'});closePrompt=false;if(r.response===1){closing=true;win.close();}
 });
 await win.loadURL(APP_URL);
}
if(ownsInstance){
app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(async()=>{
 protocol.handle('mint',async request=>{try{const a=assetPath(__dirname,request.url);return new Response(await fs.readFile(a.path),{headers:{'Content-Type':a.mime,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});}catch{return new Response('Not found',{status:404});}});
 // All inference assets are local. Neither photos nor telemetry can leave the app.
 session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!['mint:','blob:','data:','devtools:'].includes(new URL(d.url).protocol)}));
 session.defaultSession.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));
 session.defaultSession.setPermissionCheckHandler(()=>false);
 handle('app:info',()=>({version:app.getVersion(),platform:process.platform}));
 handle('recovery:status',()=>recovery().status());
 handle('recovery:configure',payload=>recoveryAction('configure',payload));
 handle('recovery:save',payload=>saveRecovery(payload));
 handle('recovery:open',payload=>recoveryAction('open',payload));
 handle('recovery:cancel',()=>recovery().cancel());
 handle('project:save',payload=>projects().save(payload));
 handle('project:open',()=>projects().open());
 handle('project:confirm-replace',()=>projects().confirmReplace());
 handle('presets:list',()=>presets().list());
 handle('presets:save',payload=>presets().save(payload));
 handle('presets:remove',id=>presets().remove(id));
 handle('presets:restore',id=>presets().restore(id));
 handle('presets:open',()=>presets().open());
 handle('presets:export',document=>presets().export(document));
 handle('presets:recover',()=>presets().recoverBackup());
 handle('backend:probe',()=>backend().probe());
 handle('backend:parse',request=>backend().parse(request));
 handle('backend:parse-masks',request=>backend().parseMasks(request));
 handle('backend:matte',request=>backend().matte(request));
 handle('backend:cancel',requestId=>backend().cancel(requestId));
 handle('image-assets:import',request=>{if(closing)throw new Error('应用正在关闭');return imageImportService().importImage(request);});
 handle('image-assets:cancel',requestId=>imageImports?.cancel(requestId)||false);
 handle('images:open',async()=>{
  if(importDialogActive)return[];importDialogActive=true;
  try{const r=await dialog.showOpenDialog(win,{title:'导入人像照片',properties:['openFile','multiSelections'],filters:[{name:'照片 JPEG / PNG / WebP',extensions:['jpg','jpeg','png','webp']}]});
  if(r.canceled)return[];if(r.filePaths.length>100)throw new Error('一次最多导入 100 张照片。');
  const stats=await Promise.all(r.filePaths.map(p=>fs.stat(p)));
  if(stats.some(s=>!s.isFile()||s.size>MAX_FILE_BYTES)||stats.reduce((n,s)=>n+s.size,0)>MAX_IMPORT_BYTES)throw new Error('每张照片限 80 MB，每次导入合计限 400 MB。');
  const out=[];for(let i=0;i<r.filePaths.length;i++){const p=r.filePaths[i];if(!/\.(jpe?g|png|webp)$/i.test(p))continue;out.push({name:path.basename(p),bytes:new Uint8Array(await fs.readFile(p)),size:stats[i].size});}return out;
  }finally{importDialogActive=false;}
 });
 handle('export:render',payload=>exportsService().render(payload));
 handle('export:cancel-render',requestId=>exportsService().cancel(requestId));
 handle('export:choose-folder',async()=>{const r=await dialog.showOpenDialog(win,{title:'选择导出文件夹',properties:['openDirectory','createDirectory']});if(r.canceled)return null;const token=crypto.randomUUID();folderTokens.clear();folderTokens.set(token,r.filePaths[0]);return{token,displayPath:r.filePaths[0]};});
 handle('export:write',async payload=>{if(!payload||typeof payload!=='object')throw new Error('Invalid export');const dir=folderTokens.get(payload.folderToken);if(!dir)throw new Error('请重新选择导出文件夹。');activeExportWrites++;try{return await writeUniqueImage(dir,payload.name,payload.bytes);}finally{activeExportWrites--;}});
 ipcMain.on('session:dirty',(e,value)=>{try{trusted(e);dirty=value===true}catch{}});
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:'文件',submenu:[{label:'导入照片',accelerator:'CmdOrCtrl+O',click:()=>action('import')},{label:'打开工程',accelerator:'CmdOrCtrl+Shift+O',click:()=>action('open-project')},{label:'保存工程',accelerator:'CmdOrCtrl+S',click:()=>action('save-project')},{label:'导出照片',accelerator:'CmdOrCtrl+Shift+E',click:()=>action('export')},{type:'separator'},{role:'quit',label:'退出'}]},
  {label:'编辑',submenu:[{label:'撤销',accelerator:'CmdOrCtrl+Z',click:()=>action('undo')},{label:'重做',accelerator:'CmdOrCtrl+Shift+Z',click:()=>action('redo')}]},
  {label:'视图',submenu:[{role:'togglefullscreen',label:'全屏'}]},
  {label:'帮助',submenu:[{label:'关于薄荷人像',click:()=>dialog.showMessageBox(win,{type:'info',title:'关于薄荷人像',message:`薄荷人像 Desktop ${app.getVersion()} · 离线开发版`,detail:'本地人脸关键点与人物分割，照片不上传。支持 JPEG、PNG、WebP 导入；JPEG、PNG 导出。非 Pixel Cake 官方产品。\n\n本版本未签名，未完成 Windows 真机验证。支持手动保存自包含工程。可选本机两代恢复草稿默认关闭，不代替正式保存。无 RAW、16-bit 或软打样。导出为 8-bit sRGB；基础调色/局部层原尺寸上限 6400 万像素，人像/背景处理上限 1600 万像素。工作尺寸降采样须明确选择。'})}]}
 ]));
 await createWindow();
});
app.on('window-all-closed',()=>app.quit());
// before-quit runs before BrowserWindow's close confirmation and may be cancelled.
// Only tear down persistent services once all windows have actually agreed to close.
app.on('will-quit',()=>{imageImports?.dispose();recoveryFiles?.cancel();portraitBackend?.dispose();exportRenderer?.dispose();});
}
