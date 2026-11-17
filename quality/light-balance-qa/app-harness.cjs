'use strict';
// Authored DOM/IPC shell plus installed NativeCanvas. Shipped app.js executes
// unchanged; this is not a browser, Electron screen capture or Windows test.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),vm=require('node:vm');
const base=path.resolve(__dirname,'../text-qa/app-harness.cjs');
let wrapper=fs.readFileSync(base,'utf8');
const hook=`
replace('const Presets = PresetModule.createCodec({advancedTone:Tone,levels:Levels});', "const LightBalance=require('../src/light-balance.cjs'); const Presets=PresetModule.createCodec({advancedTone:Tone,levels:Levels,lightBalance:LightBalance});");
replace('window:{MintTextOverlay:', 'window:{MintLightBalance:overrides.lightBalanceCore===false?null:wrapCore(LightBalance),MintTextOverlay:');
replace('PresetModule.createCodec({advancedTone:dependencies.advancedTone,levels:dependencies.levels})', 'PresetModule.createCodec({advancedTone:dependencies.advancedTone,levels:dependencies.levels,...(dependencies.lightBalance?{lightBalance:LightBalance}:{})})');
`;
if(!wrapper.includes('const compiled=new Module'))throw Error('Native QA wrapper changed');
wrapper=wrapper.replace('const compiled=new Module',hook+'\nconst compiled=new Module');
const compiled=new Module(base,module);compiled.filename=base;compiled.paths=Module._nodeModulePaths(path.dirname(base));compiled._compile(wrapper,base);
const prefix=fs.readFileSync(path.resolve(__dirname,'../../src/pipeline.js'),'utf8').split('const preset =')[0].replace(/^import .*$/mg,'').replace(/export /g,'');
const helper=vm.runInNewContext(prefix+'; lightBalanceInputSettings',{structuredClone});
function harness(overrides={}){
  const h=compiled.exports.harness({...overrides,pipeline:{lightBalanceInputSettings:settings=>helper(structuredClone(settings)),...overrides.pipeline}});
  vm.runInContext('Object.assign(audit,{lightBalanceReady,editLightBalance,updateLightBalanceControls,whiteBalanceFrameReady,beginWhiteBalancePoint,finishWhiteBalancePoint,cancelWhiteBalancePointer,lightState:()=>({whiteBalancePick,pointer,tool,acceptedRender})})',h.context);
  return h;
}
module.exports={harness};
