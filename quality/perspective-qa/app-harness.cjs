'use strict';
// Straighten current-code QA: current candidate app.js executes without source substitution.
// The DOM/IPC shell is authored, the canvas is installed NativeCanvas, and the
// paint/text/redaction/export cores are real. This is NOT browser/Windows QA.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),vm=require('node:vm');
const NativeQA=require('../text-qa/native-support.cjs');
if(!NativeQA.Native)throw new Error('Required installed NativeCanvas is missing; paint QA cannot be skipped');
const filename=path.resolve(__dirname,'../../tests/text-ui.test.cjs');
let source=fs.readFileSync(filename,'utf8').split('\nconst plain=')[0];
if(source.includes("test('text DOM"))throw Error('Authored DOM extraction boundary changed');
function replace(before,after){if(!source.includes(before))throw Error('QA shell anchor changed: '+before);source=source.replace(before,after);}
replace('const sourceBytes=png();',"const NativeQA=require('../quality/text-qa/native-support.cjs'); const sourceBytes=new Uint8Array(NativeQA.fixture(100,80).toBuffer('image/png'));");
replace('  calls.thumbnailCount=0;', '  NativeQA.install(Element,overrides,calls);\n  calls.thumbnailCount=0;');
replace("const canvas=(w,h)=>Object.assign(new Element('canvas'),{width:w,height:h});", "const canvas=(w,h)=>{const out=Object.assign(new Element('canvas'),{width:w,height:h});out.getContext('2d').drawImage(NativeQA.fixture(w,h),0,0);return out;};");
replace('const Presets = PresetModule.createCodec({advancedTone:Tone,levels:Levels});', "const LightBalance=require('../src/light-balance.cjs'),Paint=require('../src/paint-layer.cjs'),PaintLayers=require('../src/paint-layers.cjs'),PaintRenderer=require('../src/paint-layer-renderer.cjs'),Redaction=require('../src/redaction-layers.cjs'),Redact=require('../src/redact-core.cjs'); const Presets=PresetModule.createCodec({advancedTone:Tone,levels:Levels,lightBalance:LightBalance});");
replace('if(options.deferTextLayers||options.sourceView||options.manualEditing)effective.textLayers=[];', 'if(options.deferTextLayers||options.sourceView||options.manualEditing)effective.textLayers=[];if(options.deferPaintLayers||options.sourceView||options.manualEditing)effective.paintLayers=null;if(options.deferRedactions||options.sourceView||options.manualEditing)effective.redactions=null;');
replace('PresetModule.createCodec({advancedTone:dependencies.advancedTone,levels:dependencies.levels})', 'PresetModule.createCodec({advancedTone:dependencies.advancedTone,levels:dependencies.levels,...(dependencies.lightBalance?{lightBalance:LightBalance}:{})})');
const begin=source.indexOf('  const service={'),end=source.indexOf('  const context=vm.createContext',begin);
if(begin<0||end<0)throw Error('Authored DOM service anchors changed');
source=source.slice(0,begin)+`
  const service=NativeQA.service({createElement:t=>new Element(t),fonts:overrides.fonts||{ready:Promise.resolve()}},calls,overrides);
  const cloneData=a=>{if(a&&typeof a==='object'&&typeof a.shouldCancel==='function'){const {shouldCancel,...rest}=a;return {...structuredClone(rest),shouldCancel};}return structuredClone(a);};
  const compatible=core=>Object.fromEntries(Object.entries(core).map(([key,fn])=>[key,typeof fn==='function'?(...args)=>fn(...args.map(cloneData)):fn]));
  calls.paintRasters=[];calls.paintEnvelopes=[];calls.paintComposites=[];
  const realPaint=PaintRenderer.create({document:{createElement:t=>new Element(t)},crypto:cryptoNode.webcrypto,layersCore:PaintLayers});
  const opts=o=>({...o,...('layers'in o?{layers:structuredClone(o.layers)}:{}),...('context'in o?{context:cloneData(o.context)}:{}),...('preparedRaster'in o?{preparedRaster:structuredClone(o.preparedRaster)}:{})});
  const paintService={
    hashBytes:(bytes,o)=>realPaint.hashBytes(bytes,o===undefined?undefined:{...o}),
    async raster(o){calls.paintRasters.push(o);await overrides.paintRasterWait?.(o);return realPaint.raster(opts(o));},
    async compositePreview(base,raster,o){calls.paintComposites.push({base,raster});const out=await realPaint.compositePreview(base,raster,{...o});await overrides.afterPaintComposite?.(out);return out;},
    envelope(o){calls.paintEnvelopes.push(o);return realPaint.envelope(opts(o));}
  };
`+source.slice(end);
replace('window:{MintTextOverlay:', `window:{MintExportSize:wrapCore(require('../src/export-size.cjs')),MintExportResize:require('../src/export-resize.cjs'),MintPaintLayers:overrides.paintCore===false?null:compatible(PaintLayers),MintPaintLayer:overrides.paintCore===false?null:{...Paint,createProfile:()=>compatible(Paint.createProfile('desktop')),hasPaint:r=>Paint.hasPaint(structuredClone(r))},MintPaintLayerRenderer:overrides.paintRenderer===false?null:{create:()=>paintService},MintRedactionLayers:compatible(Redaction),MintRedact:{createProfile:()=>compatible(Redact.createProfile('desktop'))},MintLightBalance:wrapCore(LightBalance),MintTextOverlay:`);
replace("setTimeout:(fn,delay)=>{if(delay===0)queueMicrotask(fn);return ++timer;},clearTimeout(){}", "setTimeout:(fn,delay)=>delay===0?setTimeout(fn,0):++timer,clearTimeout:id=>{if(typeof id==='object')clearTimeout(id);}");
replace('window:{MintExportSize:',"window:{MintPortraitPeople:overrides.peopleCore===false?null:compatible(require('../src/portrait-people.cjs')),MintPortraitPeopleDesktop:overrides.peopleCore===false?null:compatible(require('../src/portrait-people-desktop.cjs')),MintExportSize:");
replace('window:{MintPortraitPeople:',"window:{MintStraighten:overrides.straightenCore===false?null:compatible(require('../src/straighten.cjs')),MintPortraitPeople:");
replace('effective.framing=null;effective.canvasPadding=null;', 'effective.framing=null;effective.straighten=null;effective.perspective=null;effective.canvasPadding=null;');
replace('const codec={VERSION:Codec.VERSION,encode:',"const codec={VERSION:Codec.VERSION,validateSettings:(...args)=>Codec.validateSettings(...args.map(x=>structuredClone(x))),encode:");
replace("return out;},encode:", "const receipt=ExportCore.sizePlan(c.width,c.height,'original',effective).perspectiveReceipt;if(receipt)Object.defineProperty(out,'perspectiveReceipt',{value:receipt});return out;},encode:");
replace('window:{MintStraighten:', "window:{MintPerspective:overrides.perspectiveCore===false?null:compatible(require('../src/perspective.cjs')),MintStraighten:");
source+='\nmodule.exports={harness,sourceBytes};';
const compiled=new Module(filename,module);compiled.filename=filename;compiled.paths=Module._nodeModulePaths(path.dirname(filename));compiled._compile(source,filename);
const prefix=fs.readFileSync(path.resolve(__dirname,'../../src/pipeline.js'),'utf8').split('const preset =')[0].replace(/^import .*$/mg,'').replace(/export /g,'');
const helper=vm.runInNewContext(prefix+'; lightBalanceInputSettings',{structuredClone});
const presetSource=fs.readFileSync(path.resolve(__dirname,'../../src/pipeline.js'),'utf8').split('const local =')[0].replace(/^import .*$/mg,'').replace(/export /g,'');
const realPresets=vm.runInNewContext(presetSource+'; PRESETS',{structuredClone});
function productionPipeline(h){
  const file=path.resolve(__dirname,'../../src/pipeline.js');
  const code=fs.readFileSync(file,'utf8').replace(/^import .*$/mg,'').replace(/export /g,'').replaceAll('import.meta.url',JSON.stringify(require('node:url').pathToFileURL(file).href));
  const scope={...h.context,...h.context.window,window:h.context.window,document:h.context.document,Uint8Array,Uint8ClampedArray,Float32Array,ArrayBuffer,AbortController,URL,console,structuredClone};
  vm.createContext(scope);vm.runInContext(code+';globalThis.actualPreflight=preflightRender;globalThis.actualEncode=encode;',scope);
  return {preflightRender:(...args)=>scope.actualPreflight(...args),encode:(...args)=>scope.actualEncode(...args)};
}
function harness(overrides={}){
  const h=compiled.exports.harness({...overrides,pipeline:{PRESETS:structuredClone(realPresets),lightBalanceInputSettings:s=>helper(structuredClone(s)),...overrides.pipeline}});
  h.pipeline.preflightRender=overrides.pipeline?.preflightRender||productionPipeline(h).preflightRender;
  vm.runInContext('Object.assign(audit,{paintReady,paintFrameReady,paintContext,beginPaintStroke,appendPaintStroke,finishPaintStroke,preparePaintRaster,updatePaintControls,redactionReady,redactionFrameReady,paintState:()=>({paintDraft,paintPick,paintRasterCache,redactionPointers,pointer}),paintSetCache:(value)=>paintRasterCache=value})',h.context);
  vm.runInContext('Object.assign(audit,{enablePeople,selectedPerson,setAdjustment,updatePeopleControls,updateControls,diagnosticViewActive,drawPeopleBoxes})',h.context);
  vm.runInContext('Object.assign(audit,{straightenRetainedBytes,straightenSetRetainedRasters:(text,paint)=>{textRasterCache={raster:text};paintRasterCache={raster:paint};},straightenSetRetainedCanvas:c=>referenceRightCanvas=c,updateStraightenControls,applyStraightenForm,straightenDraftCurrent,cancelStraightenDraft,straightenPlan,finalCanvasPlan,prepareStraightenedOriginal,renderExportItem,straightenState:()=>({straightenDraft,framedOriginalCache,acceptedRender,renderPending,renderFailure})})',h.context);
  vm.runInContext('Object.assign(audit,{startPerspectiveDraft,applyPerspectiveDraft,cancelPerspectiveDraft,perspectivePlan,perspectiveActive,perspectiveDraftCurrent,perspectiveInputReady,updatePerspectiveControls,beginPerspectivePoint,appendPerspectivePoint,cancelPerspectivePointer,requirePerspectiveReceipt,editPerspectiveForm,perspectiveState:()=>({perspectiveDraft,pointer,acceptedRender,renderPending,renderFailure,framedOriginalCache}),setPerspectiveRetainedCanvas:c=>referenceRightCanvas=c})',h.context);
  return h;
}
module.exports={harness,productionPipeline,sourceBytes:compiled.exports.sourceBytes,NativeQA};
