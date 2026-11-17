'use strict';
// Reuse only the existing authored DOM/IPC shell, not its text raster double.
// Fail explicitly if the shell changes. Shipped app.js and all real text cores
// execute without source edits; Canvas draw/read/scale is installed NativeCanvas.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const filename=path.resolve(__dirname,'../../tests/text-ui.test.cjs');
let source=fs.readFileSync(filename,'utf8').split('\nconst plain=')[0];
if(source.includes("test('text DOM"))throw Error('Text harness extraction boundary changed');
function replace(before,after){if(!source.includes(before))throw Error('QA harness anchor changed: '+before);source=source.replace(before,after);}
replace('const sourceBytes=png();',"const NativeQA=require('../quality/text-qa/native-support.cjs'); const sourceBytes=new Uint8Array(NativeQA.fixture(100,80).toBuffer('image/png')); ");
replace('  calls.thumbnailCount=0;', '  NativeQA.install(Element,overrides,calls);\n  calls.thumbnailCount=0;');
replace("const canvas=(w,h)=>Object.assign(new Element('canvas'),{width:w,height:h});", "const canvas=(w,h)=>{const out=Object.assign(new Element('canvas'),{width:w,height:h});out.getContext('2d').drawImage(NativeQA.fixture(w,h),0,0);return out;};");
const begin=source.indexOf('  const service={'),end=source.indexOf('  const context=vm.createContext',begin);
if(begin<0||end<0)throw Error('QA text service anchors changed');
source=source.slice(0,begin)+`  const service=NativeQA.service({createElement:t=>new Element(t),fonts:overrides.fonts||{ready:Promise.resolve()}},calls,overrides);\n`+source.slice(end);
// Host-domain service boundary normalizes cross-realm plain request objects only.
source+='\nmodule.exports={harness,sourceBytes};';
const compiled=new Module(filename,module);compiled.filename=filename;compiled.paths=Module._nodeModulePaths(path.dirname(filename));compiled._compile(source,filename);
module.exports=compiled.exports;
