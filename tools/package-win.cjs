'use strict';
const path=require('node:path'),fs=require('node:fs/promises');
const APP_FILES=['main.cjs','preload.cjs','desktop-core.cjs','project-store.cjs','preset-store.cjs','recovery-store.cjs','desktop-ai.cjs','desktop-backend.cjs','export-renderer.cjs','export-render-worker.cjs','export-render-core.cjs','image-import.cjs','image-import-worker.cjs','image-import-decode.cjs','image-import-guards.cjs','package.json'];
const BACKEND_FILES=['backend/catalog.cjs','backend/adapters/segface/mask.cjs','backend/adapters/segface/manifest.json'];
const CONTENT_DIRS=['src','assets'];
const PROD_PACKAGES=['sharp','@img/colour','@img/sharp-win32-x64','detect-libc','semver'];
async function prepareStage(root){
 const stage=path.join(root,'.build/app-win32');await fs.rm(stage,{recursive:true,force:true});await fs.mkdir(stage,{recursive:true});
 for(const name of [...APP_FILES,...BACKEND_FILES]){await fs.mkdir(path.dirname(path.join(stage,name)),{recursive:true});await fs.copyFile(path.join(root,name),path.join(stage,name));}
 for(const name of CONTENT_DIRS)await fs.cp(path.join(root,name),path.join(stage,name),{recursive:true});
 // Private source may retain a legacy informational fixture, never install it.
 await fs.rm(path.join(stage,'assets/demo.png'),{force:true});
 for(const name of PROD_PACKAGES){const source=path.join(root,'.build/win-deps/node_modules',name);await fs.access(path.join(source,'package.json'));await fs.mkdir(path.dirname(path.join(stage,'node_modules',name)),{recursive:true});await fs.cp(source,path.join(stage,'node_modules',name),{recursive:true});}
 const sharp=JSON.parse(await fs.readFile(path.join(stage,'node_modules/sharp/package.json')));if(sharp.version!=='0.35.5')throw new Error('Unpinned Sharp runtime');
 return stage;
}
async function build(){
 const {packager}=await import('@electron/packager'),root=path.resolve(__dirname,'..'),stage=await prepareStage(root),manifest=require('../package.json');
 const localZipDir=process.env.ELECTRON_ZIP_DIR;
 if(localZipDir){const crypto=require('node:crypto'),zip=await fs.readFile(path.join(localZipDir,'electron-v45.0.0-win32-x64.zip'));if(crypto.createHash('sha256').update(zip).digest('hex')!=='ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47')throw new Error('Local Electron runtime checksum mismatch');}
 const builds=await packager({...(localZipDir?{electronZipDir:localZipDir}:{}),dir:stage,out:path.join(root,'dist'),name:'Mint Portrait',executableName:'MintPortrait',platform:'win32',arch:'x64',electronVersion:manifest.devDependencies.electron,download:{cacheRoot:'/tmp/mint-electron-cache'},asar:{unpackDir:'node_modules/@img'},overwrite:true,prune:false,icon:path.join(root,'assets/icon.ico'),appVersion:manifest.version,win32metadata:{CompanyName:'Mint Portrait',FileDescription:'薄荷人像 Desktop 开发候选版',ProductName:'薄荷人像'},quiet:false});console.log(JSON.stringify({builds}));
}
module.exports={APP_FILES,BACKEND_FILES,CONTENT_DIRS,PROD_PACKAGES,prepareStage};
if(require.main===module)build().catch(e=>{console.error(e);process.exitCode=1;});
