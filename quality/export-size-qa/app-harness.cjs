'use strict';
// Authored DOM/IPC shell + installed NativeCanvas bridge. The shipped app.js,
// text renderer and pixel core run unchanged. This is not a browser/Windows test.
const {harness:base}=require('../text-qa/app-harness.cjs');
const Size=require('../../src/export-size.cjs'),Resize=require('../../src/export-resize.cjs');
function harness(overrides={}){
 const h=base(overrides);
 h.context.window.MintExportSize=overrides.sizeCore===false?null:Object.fromEntries(Object.entries(Size).map(([k,v])=>[k,typeof v==='function'?(...args)=>v(...args.map(x=>structuredClone(x))):v]));
 h.context.window.MintExportResize=overrides.resizeCore===false?null:{applyCanvas:(canvas,recipe,create,options)=>Resize.applyCanvas(canvas,structuredClone(recipe),create,options)};
 h.get('exportOutputMode').value='unchanged';h.get('exportLongEdge').value='1280';
 h.output=(edge)=>{h.get('exportOutputMode').value=edge===null?'unchanged':'long-edge';if(edge!==null)h.get('exportLongEdge').value=String(edge);h.fire('exportOutputMode','change');h.fire('exportLongEdge','input');};
 return h;
}
module.exports={harness};
