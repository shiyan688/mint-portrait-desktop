'use strict';
// Host-only user-preset persistence. Renderer supplies documents/opaque IDs, never paths.
const Fs=require('node:fs/promises'),Path=require('node:path'),Crypto=require('node:crypto');
const HEADER='MINT-PRESET-CATALOG/1\n',MAX_BYTES=512*1024,MAX_PRESETS=100,MAX_TRASH=20,MAX_DOCUMENT=64*1024;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function check(v,m){if(!v)throw new Error(m);}
function fields(v,required,optional=[]){
 check(v&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null),'无效的预设操作');const out=Object.create(null);
 for(const key of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,key);check(typeof key==='string'&&(required.includes(key)||optional.includes(key))&&d.enumerable&&Object.hasOwn(d,'value'),'无效的预设操作字段');out[key]=d.value;}
 for(const key of required)check(Object.hasOwn(out,key),'缺少预设操作字段');return out;
}
function createPresetStore({root,dialog,getWindow=()=>undefined,codec,fsImpl=Fs}){
 check(Path.isAbsolute(root),'Preset root must be an absolute host path');check(codec&&['parse','stringify','validate'].every(k=>typeof codec[k]==='function'),'Preset codec unavailable');
 const fs=fsImpl,file=Path.join(root,'catalog.mintpresets'),backup=Path.join(root,'catalog.previous.mintpresets');let busy=false;
 const withBusy=async fn=>{check(!busy,'预设操作进行中，请稍候');busy=true;try{return await fn();}finally{busy=false;}};
 const safeId=id=>{check(typeof id==='string'&&UUID.test(id),'无效的预设编号');return id;};
 const nameKey=d=>d.name.normalize('NFC').toLowerCase();
 const identity=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.nlink].join(':');
 function decodeUtf8(bytes){const s=bytes.toString('utf8');check(Buffer.from(s,'utf8').equals(bytes),'预设文件不是有效的UTF-8文本');return s;}
 async function readSafe(p,limit,missing=false){
  let info;try{info=await fs.lstat(p);}catch(e){if(missing&&e.code==='ENOENT')return null;throw e;}
  check(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<=limit,'预设文件类型或大小不受支持');let handle;
  try{handle=await fs.open(p,'r');const current=await handle.stat();check(current.isFile()&&identity(current)===identity(info),'预设文件在读取期间改变');
   const data=Buffer.alloc(current.size);let offset=0;while(offset<data.length){const {bytesRead}=await handle.read(data,offset,data.length-offset,offset);check(bytesRead>0,'预设文件在读取期间变短');offset+=bytesRead;}const extra=Buffer.alloc(1);check((await handle.read(extra,0,1,offset)).bytesRead===0&&identity(await handle.stat())===identity(current),'预设文件在读取期间改变');return data;
  }finally{await handle?.close();}
 }
 function parseCatalog(bytes){
  const s=decodeUtf8(bytes);check(s.startsWith(HEADER)&&s.endsWith('\n'),'预设库损坏或版本不受支持');const tail=s.slice(HEADER.length,-1);check(s===HEADER||tail.length>0,'预设库包含空记录');const lines=tail?tail.split('\n'):[];check(lines.every(Boolean),'预设库包含空记录');check(lines.length<=MAX_PRESETS+MAX_TRASH,'预设库项目过多');const ids=new Set(),names=new Set(),out={items:[],trash:[]};
  for(const line of lines){const parts=line.split(' ');check(parts.length===3&&['A','T'].includes(parts[0]),'预设库记录损坏');const id=safeId(parts[1]);check(!ids.has(id),'预设库编号重复');ids.add(id);const encoded=parts[2];check(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)&&encoded.length<=Math.ceil(MAX_DOCUMENT/3)*4,'预设库记录损坏');
   const bytes=Buffer.from(encoded,'base64');check(bytes.toString('base64')===encoded&&bytes.length<=MAX_DOCUMENT,'预设库记录损坏');const document=codec.parse(decodeUtf8(bytes)),key=nameKey(document);if(parts[0]==='A'){check(!names.has(key),'预设名称重复');names.add(key);}out[parts[0]==='A'?'items':'trash'].push({id,document});
  }
  check(out.items.length<=MAX_PRESETS&&out.trash.length<=MAX_TRASH,'预设库容量超限');return out;
 }
 function serializeCatalog(c){const lines=[];for(const [kind,items] of [['A',c.items],['T',c.trash]])for(const item of items){const s=codec.stringify(item.document),b=Buffer.from(s);check(b.length<=MAX_DOCUMENT,'预设配方过大');lines.push(`${kind} ${safeId(item.id)} ${b.toString('base64')}`);}const b=Buffer.from(HEADER+lines.map(l=>l+'\n').join(''));check(b.length<=MAX_BYTES,'预设库容量超限');parseCatalog(b);return b;}
 async function checkRoot(){const r=await fs.lstat(root).catch(e=>{if(e.code==='ENOENT')return null;throw e;});check(!r||(r.isDirectory()&&!r.isSymbolicLink()),'预设目录不受支持');}
 async function load(){await checkRoot();const bytes=await readSafe(file,MAX_BYTES,true);if(bytes)return{catalog:parseCatalog(bytes),bytes};const b=await readSafe(backup,MAX_BYTES,true);check(!b,'主预设库缺失；请使用“恢复上次备份”，不会创建空库覆盖它');return{catalog:{items:[],trash:[]},bytes:null};}
 async function ensureRoot(){await fs.mkdir(root,{recursive:true});const s=await fs.lstat(root);check(s.isDirectory()&&!s.isSymbolicLink(),'预设目录不受支持');}
 async function atomic(p,bytes,options={}){
  check(Path.isAbsolute(p),'保存位置必须来自本机文件对话框');
  const expected=Object.hasOwn(options,'expected')?options.expected:await readSafe(p,MAX_BYTES,true),dir=Path.dirname(p),tmp=Path.join(dir,`.mint-preset-${Crypto.randomUUID()}.tmp`);let h,committed=false,warning=null;
  try{h=await fs.open(tmp,'wx',0o600);await h.writeFile(bytes);await h.sync();await h.close();h=null;
   const now=await readSafe(p,MAX_BYTES,true);check((expected===null)===(now===null)&&(!expected||expected.equals(now)),'保存目标已被其他操作改变，未覆盖；请重试或另存');
   if(expected===null){await fs.link(tmp,p);committed=true;try{await fs.unlink(tmp);}catch{warning='已保存，但同目录临时副本清理失败。';}}
   else{await fs.rename(tmp,p);committed=true;}
   if(process.platform!=='win32'){let d;try{d=await fs.open(dir,'r');await d.sync();}catch{warning='已提交保存，但文件系统未确认目录刷新；断电持久性未经确认。';}finally{await d?.close().catch(()=>{});}}
   return {durabilityWarning:warning};
  }finally{await h?.close().catch(()=>{});if(!committed)await fs.unlink(tmp).catch(()=>{});}
 }
 async function commit(c,previous){const bytes=serializeCatalog(c);await ensureRoot();let previousResult;if(previous)previousResult=await atomic(backup,previous);const result=await atomic(file,bytes,{expected:previous});return{durabilityWarning:result.durabilityWarning||previousResult?.durabilityWarning||null};}
 const publicCatalog=c=>({items:c.items.map(x=>({id:x.id,document:codec.validate(x.document)})),trash:c.trash.map(x=>({id:x.id,document:codec.validate(x.document)}))});
 const unique=(c,doc,id)=>check(!c.items.some(x=>x.id!==id&&nameKey(x.document)===nameKey(doc)),'已存在同名预设；请选择该预设更新，或使用不同名称');
 return Object.freeze({
  isBusy:()=>busy,
  list:()=>withBusy(async()=>publicCatalog((await load()).catalog)),
  save:payload=>withBusy(async()=>{const v=fields(payload,['document'],['id']),document=codec.validate(v.document),state=await load(),c=state.catalog;let id;
   if(Object.hasOwn(v,'id')){id=safeId(v.id);check(c.items.some(x=>x.id===id),'未找到要更新的预设');}else{check(c.items.length<MAX_PRESETS,'最多保存100个预设');id=Crypto.randomUUID();}
   unique(c,document,id);const item={id,document},index=c.items.findIndex(x=>x.id===id);if(index<0)c.items.push(item);else c.items[index]=item;const result=await commit(c,state.bytes);return{id,document:codec.validate(document),...result};
  }),
  remove:id=>withBusy(async()=>{safeId(id);const state=await load(),c=state.catalog,index=c.items.findIndex(x=>x.id===id);check(index>=0,'预设不存在');check(c.trash.length<MAX_TRASH,'已移除预设保留区已满；请先恢复并整理，不会自动永久删除');c.trash.push(c.items.splice(index,1)[0]);const result=await commit(c,state.bytes);return{...publicCatalog(c),...result};}),
  restore:id=>withBusy(async()=>{safeId(id);const state=await load(),c=state.catalog,index=c.trash.findIndex(x=>x.id===id);check(index>=0&&c.items.length<MAX_PRESETS,'无法恢复此预设');const item=c.trash[index];unique(c,item.document,item.id);c.trash.splice(index,1);c.items.push(item);const result=await commit(c,state.bytes);return{...publicCatalog(c),...result};}),
  open:()=>withBusy(async()=>{const r=await dialog.showOpenDialog(getWindow(),{title:'导入调节预设',properties:['openFile'],filters:[{name:'薄荷调节预设',extensions:['json']}]});if(r.canceled)return null;check(Array.isArray(r.filePaths)&&r.filePaths.length===1,'请选择一个预设文件');check(typeof r.filePaths[0]==='string'&&Path.isAbsolute(r.filePaths[0])&&/\.mintpreset\.json$/i.test(r.filePaths[0]),'请选择.mintpreset.json配方文件');return codec.parse(decodeUtf8(await readSafe(r.filePaths[0],MAX_DOCUMENT)));}),
  export:document=>withBusy(async()=>{const doc=codec.validate(document),bytes=Buffer.from(codec.stringify(doc));check(bytes.length<=MAX_DOCUMENT,'预设配方过大');let name=doc.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'')||'我的预设';if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name='_'+name;
   const r=await dialog.showSaveDialog(getWindow(),{title:'导出无照片调节配方',defaultPath:name+'.mintpreset.json',filters:[{name:'薄荷调节预设',extensions:['mintpreset.json']}],properties:['showOverwriteConfirmation']});if(r.canceled||!r.filePath)return null;check(typeof r.filePath==='string'&&Path.isAbsolute(r.filePath)&&/\.mintpreset\.json$/i.test(r.filePath),'预设导出必须使用.mintpreset.json后缀，不会覆盖原图');const expected=await readSafe(r.filePath,MAX_DOCUMENT,true);if(expected)codec.parse(decodeUtf8(expected));const result=await atomic(r.filePath,bytes,{expected});return{name:Path.basename(r.filePath),bytes:bytes.length,...result};
  }),
  recoverBackup:()=>withBusy(async()=>{await checkRoot();const bytes=await readSafe(backup,MAX_BYTES),catalog=parseCatalog(bytes);const answer=await dialog.showMessageBox(getWindow(),{type:'warning',title:'恢复上次预设库备份？',message:'恢复上次保存前的预设库。当前文件将另存为恢复前备份，不会影响照片或工程。',buttons:['取消','恢复备份'],defaultId:0,cancelId:0});if(answer.response!==1)return null;await ensureRoot();
   const current=await fs.lstat(file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});check(!current||(current.isFile()&&!current.isSymbolicLink()),'当前预设库不是普通文件');const preserved=current?Path.join(root,`catalog-before-recovery-${Crypto.randomUUID()}.mintpresets`):null;if(preserved)await fs.rename(file,preserved);let result;try{result=await atomic(file,bytes);}catch(error){if(preserved){const exists=await fs.lstat(file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!exists)await fs.rename(preserved,file);}throw error;}return {...publicCatalog(catalog),...result};
  })
 });
}
module.exports=Object.freeze({createPresetStore,LIMITS:Object.freeze({maxBytes:MAX_BYTES,maxPresets:MAX_PRESETS,maxTrash:MAX_TRASH,maxDocumentBytes:MAX_DOCUMENT})});
