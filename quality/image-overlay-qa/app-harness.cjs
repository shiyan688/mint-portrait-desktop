'use strict';
// Independent image-layer QA: current production app.js executes without source substitution.
// The DOM/IPC shell is authored, the canvas is installed NativeCanvas, and the
// image/text/paint/redaction/export cores are real. This is NOT browser/Windows QA.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),vm=require('node:vm');
const NativeQA=require('../text-qa/native-support.cjs');
if(!NativeQA.Native)throw new Error('Required installed NativeCanvas is missing; image-layer QA cannot be skipped');
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
// Only the authored shell is adapted below. Production app.js executes unchanged.
replace("const LightBalance=require('../src/light-balance.cjs')", "const ImageOverlay=require('../src/image-overlay.cjs'),ImageLayers=require('../src/image-layers.cjs'),ImageAssets=require('../src/image-assets.cjs'),ImageSession=require('../src/image-layer-session.cjs'),ImagePanel=require('../src/image-layer-panel.cjs'); const LightBalance=require('../src/light-balance.cjs')");
replace("window:{MintExportSize:", "window:{MintImageLayerPanel:overrides.imagePanel===false?null:ImagePanel,MintImageOverlay:overrides.imageCore===false?null:compatible(ImageOverlay),MintImageLayers:overrides.imageCore===false?null:compatible(ImageLayers),MintImageLayerSession:overrides.imageSession===false?null:compatible(ImageSession),MintImageAssets:overrides.imageAssetsCore===false?null:{createCodec:()=>compatible(ImageAssets.createCodec({overlay:ImageOverlay}))},MintExportSize:");
replace("if(options.sourceView||options.manualEditing){effective.framing=null;", "if(options.sourceView||options.manualEditing){effective.imageLayers=[];effective.framing=null;");
replace("sourceRevision:facts?.sourceRevision});", "sourceRevision:facts?.sourceRevision},undefined,{imageAssets:structuredClone(options.imageAssets||[])});");
replace("encode:async(c)=>{calls.encodes.push(c);return new Uint8Array(sourceBytes);}", "encode:async(c)=>{calls.encodes.push(c);return new Uint8Array(c._native.toBuffer('image/png'));}");
// VM shell boundary adaptation: real queue executes in the host realm, as do
// strict image-session guards. Copy the collection into that realm; keep Blobs.
replace("MintExportQueue:require('../src/export-queue.cjs')", "MintExportQueue:{ExportQueue:class extends require('../src/export-queue.cjs').ExportQueue{constructor(sources,options){super(Array.from(sources,p=>({...p,settings:structuredClone(p.settings),imageAssets:structuredClone(p.imageAssets||[])})),structuredClone(options));}}}");
// DOM textContent replacement really clears native child options.
replace("  calls.thumbnailCount=0;", "  Object.defineProperty(Element.prototype,'textContent',{get(){return this._text||'';},set(v){this._text=String(v);this.children=[];}});\n  calls.thumbnailCount=0;");
source+='\nmodule.exports={harness,sourceBytes};';
const compiled=new Module(filename,module);compiled.filename=filename;compiled.paths=Module._nodeModulePaths(path.dirname(filename));compiled._compile(source,filename);
const prefix=fs.readFileSync(path.resolve(__dirname,'../../src/pipeline.js'),'utf8').split('const preset =')[0].replace(/^import .*$/mg,'').replace(/export /g,'');
const helper=vm.runInNewContext(prefix+'; lightBalanceInputSettings',{structuredClone});
function harness(overrides={}){
  const h=compiled.exports.harness({...overrides,pipeline:{lightBalanceInputSettings:s=>helper(structuredClone(s)),...overrides.pipeline}});
  vm.runInContext('Object.assign(audit,{paintReady,paintFrameReady,paintContext,beginPaintStroke,appendPaintStroke,finishPaintStroke,preparePaintRaster,updatePaintControls,redactionReady,redactionFrameReady,paintState:()=>({paintDraft,paintPick,paintRasterCache,redactionPointers,pointer}),paintSetCache:(value)=>paintRasterCache=value,imageState:()=>({imagePanel}),imageAssetsFor,retainImageAssets,commitImageLayers,historyCommit,updateAvailability,presetDocumentFromPhoto})',h.context);
  return h;
}
module.exports={harness,sourceBytes:compiled.exports.sourceBytes,NativeQA};
