'use strict';
// Production app.js with authored DOM/IPC shell and installed NativeCanvas, NOT browser/Windows.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),vm=require('node:vm');
const filename=path.resolve(__dirname,'../light-balance-qa/app-harness.cjs');
let wrapper=fs.readFileSync(filename,'utf8');
const extra=`
replace("const Presets=PresetModule.createCodec({advancedTone:Tone,levels:Levels,lightBalance:LightBalance});", "const Presets=PresetModule.createCodec({advancedTone:Tone,levels:Levels,lightBalance:LightBalance}); const Redaction=require('../src/redaction-layers.cjs'),Redact=require('../src/redact-core.cjs');");
replace('window:{MintLightBalance:', 'window:{MintRedactionLayers:overrides.redactionCore===false?null:Object.fromEntries(Object.entries(Redaction).map(([key,fn])=>[key,typeof fn===\\\"function\\\"?(...args)=>fn(...args.map(a=>{if(a&&typeof a===\\\"object\\\"&&typeof a.shouldCancel===\\\"function\\\"){const {shouldCancel,...rest}=a;return {...structuredClone(rest),shouldCancel};}return structuredClone(a);})):fn])),MintRedact:{createProfile:()=>({validate:r=>Redact.createProfile(\\\"desktop\\\").validate(structuredClone(r))})},MintLightBalance:');
replace('if(options.deferTextLayers||options.sourceView||options.manualEditing)effective.textLayers=[];', 'if(options.deferTextLayers||options.sourceView||options.manualEditing)effective.textLayers=[];if(options.deferRedactions||options.sourceView||options.manualEditing)effective.redactions=null;');
`;
wrapper=wrapper.replace("hook+'\\nconst compiled=new Module'", "hook+"+JSON.stringify(extra)+"+'\\nconst compiled=new Module'");
const compiled=new Module(filename,module);compiled.filename=filename;compiled.paths=Module._nodeModulePaths(path.dirname(filename));compiled._compile(wrapper,filename);
function harness(options={}){const h=compiled.exports.harness(options);vm.runInContext('Object.assign(audit,{redactionReady,redactionFrameReady,redactionContext,beginRedactionStroke,appendRedactionStroke,finishRedactionStroke,applyRedactionCanvas,redactionState:()=>({redactionDraft,redactionPointers,pointer})})',h.context);return h;}
module.exports={harness};
