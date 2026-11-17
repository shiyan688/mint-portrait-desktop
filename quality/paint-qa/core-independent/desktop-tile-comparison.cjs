'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const N=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
const C=require('../../../src/paint-layer.cjs').createProfile('desktop');
const w=5201,h=1601,points=[{x:0,y:0},{x:1,y:1},{x:.03,y:.78},{x:.9,y:.1}];
const s=(mode,opacity,width)=>({mode,opacity,width,color:'#4682b4',points});
const strokes=[s('paint',1,.12),s('erase',.5,.08),s('erase',.25,.04)];
function draw(ctx,stroke,mask){ctx.globalAlpha=mask?1:stroke.opacity;ctx.strokeStyle=mask?'#000000':stroke.color;ctx.lineWidth=stroke.width*Math.min(w,h);ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();stroke.points.forEach((p,i)=>{ctx[i?'lineTo':'moveTo'](p.x*(w-1),p.y*(h-1));});ctx.stroke();}
const actual=C.renderLayer(w,h,{version:1,strokes},{createCanvas:N.createCanvas});
const reference=N.createCanvas(w,h),rc=reference.getContext('2d');
for(const stroke of strokes){if(stroke.mode==='paint'){draw(rc,stroke,false);continue;}const mask=N.createCanvas(w,h),mc=mask.getContext('2d');draw(mc,stroke,true);const coverage=mc.getImageData(0,0,w,h).data,destination=rc.getImageData(0,0,w,h);for(let i=3;i<destination.data.length;i+=4){const a=Math.round(destination.data[i]*(1-stroke.opacity*coverage[i]/255));destination.data[i]=a;if(!a)destination.data[i-1]=destination.data[i-2]=destination.data[i-3]=0;}rc.putImageData(destination,0,0);mask.width=1;mask.height=1;}
const a=actual.getContext('2d').getImageData(0,0,w,h).data,b=rc.getImageData(0,0,w,h).data;
let peakAlpha=0,peakPremultiplied=0,differentPixels=0,flatInteriorPixels=0,flatInteriorMismatches=0,seamInteriorPixels=0,seamInteriorMismatches=0;
for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;let differs=false;for(let k=0;k<4;k++)if(a[i+k]!==b[i+k])differs=true;if(differs)differentPixels++;peakAlpha=Math.max(peakAlpha,Math.abs(a[i+3]-b[i+3]));for(let k=0;k<3;k++)peakPremultiplied=Math.max(peakPremultiplied,Math.abs(a[i+k]*a[i+3]/255-b[i+k]*b[i+3]/255));if(x<2||y<2||x>w-3||y>h-3||b[i+3]===0)continue;let flat=true;check:for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const j=((y+dy)*w+x+dx)*4;for(let k=0;k<4;k++)if(b[j+k]!==b[i+k]){flat=false;break check;}}if(flat){flatInteriorPixels++;if(differs)flatInteriorMismatches++;if(x%1000<=2||x%1000>=998||y%1000<=2||y%1000>=998){seamInteriorPixels++;if(differs)seamInteriorMismatches++;}}}
const report={scope:'One desktop-only-size Linux native fixture, tiled mask versus independent whole-viewport manual alpha erasure. Observed antialias differences are not universal bounds or cross-backend identity.',width:w,height:h,plan:C.plan(w,h,{version:1,strokes}),differentPixels,peakAlpha,peakPremultiplied,flatInteriorPixels,flatInteriorMismatches,seamInteriorPixels,seamInteriorMismatches};
assert.ok(flatInteriorPixels>100000);assert.ok(seamInteriorPixels>1000);assert.equal(flatInteriorMismatches,0);assert.equal(seamInteriorMismatches,0);
fs.writeFileSync(path.join(__dirname,'desktop-tile-comparison.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
actual.width=1;actual.height=1;reference.width=1;reference.height=1;
