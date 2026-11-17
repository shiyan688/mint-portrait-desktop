'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/UPLOAD-PROVENANCE.json'),'utf8'));
for(const f of manifest.installedFiles){
 const file=path.resolve(root,f.path);
 if(!file.startsWith(root+path.sep))throw Error('Invalid manifest path');
 const data=fs.readFileSync(file);
 if(data.length!==f.bytes||crypto.createHash('sha256').update(data).digest('hex')!==f.sha256)throw Error('Installed-source mismatch: '+f.path);
}
console.log('Verified '+manifest.installedFiles.length+' installed source/asset files. This does not validate application runtime or picture quality.');
