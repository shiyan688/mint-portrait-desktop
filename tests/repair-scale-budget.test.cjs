'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Repair=require('../src/repair-brush-core.cjs'),Core=require('../export-render-core.cjs'),P=require('../src/project-document.cjs');
const rev='repair-scale:0';
function image(w,h=w){const data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set([30+x%150,40+y%150,60+(x+y)%150,255],(y*w+x)*4);return{width:w,height:h,data};}
const command={version:1,type:'repair-stroke',mode:'clone',sourceRevision:rev,radius:.08,hardness:.5,strength:1,source:{x:.2,y:.25},points:[{x:.2,y:.65},{x:.8,y:.65}],sampleMode:'manual',selection:null};
function replay(im,c){return Core.processPixels(im,{...P.DEFAULT_SETTINGS,spots:[],localLayers:[],manualLiquify:[],manualRepair:[c]},{landmarks:[],sourceRevision:rev});}
test('oversized repair is refused consistently from tiny preview to original replay before mutation',()=>{for(const [w,h] of [[90,90],[256,256],[280,280],[900,900],[90,120],[900,1200],[120,90],[1200,900]]){const im=image(w,h),before=im.data.slice();assert.throws(()=>Repair.apply(im,command),/面积/);assert.throws(()=>replay(im,command),/面积/);assert.deepEqual(im.data,before);}});
test('short explicit source repair remains valid across preview/export sizes',()=>{const c={...command,radius:.02,source:{x:.3,y:.3},points:[{x:.5,y:.6},{x:.55,y:.6}]};for(const n of [90,256,280,900]){const im=image(n),out=replay(im,c);assert.equal(out.width,n);assert.equal(out.height,n);assert.notDeepEqual(out.data,im.data);for(let i=3;i<im.data.length;i+=4)assert.equal(out.data[i],im.data[i]);}});
