'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const N=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
const C=require('../../../src/paint-layer.cjs').createProfile('desktop');
assert.equal(typeof global.gc,'function','Run with --expose-gc for this deliberately explicit observation');
const point=[{x:0,y:0},{x:1,y:1}];const stroke=(mode,opacity,width)=>({mode,opacity,width,color:'#ff0000',points:point});
const recipe={version:1,strokes:[stroke('paint',1,.12),stroke('erase',.5,.06)]};
const report={scope:'Fresh Linux Node process, @napi-rs/canvas 0.1.100. Explicit GC is diagnostic only, not an app capability or device-memory guarantee.',samples:[]};
const snapshot=(stage,extra={})=>report.samples.push({stage,...process.memoryUsage(),...extra});
global.gc();snapshot('baseline');
for(let i=0;i<4;i++) { const start=performance.now();const c=C.renderLayer(4000,4000,recipe,{createCanvas:N.createCanvas});const pixel=Array.from(c.getContext('2d').getImageData(2000,2000,1,1).data);assert.deepEqual(pixel,[255,0,0,128]);snapshot('rendered '+i,{wallMs:performance.now()-start});c.width=1;c.height=1;global.gc();snapshot('released then explicit GC '+i); }
report.resourceUsage=process.resourceUsage();fs.writeFileSync(path.join(__dirname,'memory-observation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
