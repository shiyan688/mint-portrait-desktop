'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../src/learned-analysis.cjs');
const face=Array.from({length:478},(_,i)=>({x:.4+(i%2)*.2,y:.3+(i%3)*.15}));
test('learned ROI uses original coordinates and refuses oversized or ambiguous meshes',()=>{
 const r=A.faceROI(face,{width:1000,height:800});assert.deepEqual(r,{x:360,y:156,width:281,height:360});
 assert.throws(()=>A.faceROI(face,{width:4000,height:3000}),/104/);
 assert.throws(()=>A.faceROI([],{width:10,height:10}),/mesh/);
 assert.throws(()=>A.faceROI(face.map(p=>({...p,x:NaN})),{width:10,height:10}),/coordinates/);
});
test('crop sends exactly the ROI pixels, never preview metadata',()=>{
 const data=new Uint8ClampedArray(24).fill(17);let call;
 const result=A.crop({width:20,height:30,getContext:()=>({getImageData:(...args)=>{call=args;return{data};}})},{x:3,y:7,width:2,height:3});
 assert.deepEqual(call,[3,7,2,3]);assert.equal(result.width,2);assert.equal(result.alphaMode,'straight');
 result.data[0]=99;assert.equal(data[0],17);
});
test('mask projection is pixel-centred, bounded and independently owned',()=>{
 const src={width:2,height:2,data:new Float32Array([0,1,0,1])};
 const r=A.resampleMask(src,4,2);assert.deepEqual([...r.data],[0,.25,.75,1,0,.25,.75,1]);
 const identity=A.resampleMask(src,2,2);assert.deepEqual(identity.data,src.data);identity.data[0]=1;assert.equal(src.data[0],0);
 assert.throws(()=>A.resampleMask({...src,data:new Float32Array([0,NaN,0,1])},2,2),/probability/);
});
function fixture(task='matting'){
 const roi={x:3,y:4,width:2,height:2},selection={kind:'detected-face',faceId:'face-1',revision:'source-1'};
 const request={modelId:'official',modelVersion:'pinned',device:'cpu',originalSize:{width:20,height:20},roi,selection};
 const provenance={kind:'model',task,modelId:'official',modelVersion:'pinned',device:{kind:'cpu'},weightsSha256:'a'.repeat(64),selection,maskClasses:{skin:['skin','nose']},classVocabulary:require('../backend/adapters/segface/manifest.json').classes,
  maskPolicy:{version:'segface-conservative-v1',kind:'deterministic-mask-postprocessing-not-a-retouch-model',guard:{units:'original-roi-pixels',outsideRoi:'fully-protected',radiusPx:2}}};
 return{request,provenance,roi};
}
test('parsing validates exact selection and semantic union, never accepts a nose island',()=>{
 const {request,provenance,roi}=fixture('parse'),result={kind:'face-masks',width:2,height:2,roi,skin:new Float32Array(4),protected:new Float32Array(4).fill(1),provenance};
 assert.equal(A.validateParse(result,request),result);
 assert.throws(()=>A.validateParse({...result,provenance:{...provenance,maskClasses:{skin:['skin']}}},request),/nose/);
 assert.throws(()=>A.validateParse({...result,provenance:{...provenance,selection:{...provenance.selection,revision:'stale'}}},request),/revision/);
 assert.throws(()=>A.validateParse({...result,roi:{...roi,x:4}},request),/geometry/);
 assert.throws(()=>A.validateParse({...result,protected:new Float32Array(4)},request),/complements/);
 assert.throws(()=>A.validateParse({...result,provenance:{...provenance,maskPolicy:null}},request),/policy/);
});
test('matting rejects invalid geometry, probability or provenance and never silently rescales',()=>{
 const {request,provenance,roi}=fixture(),matte={width:2,height:2,roi,data:new Float32Array([0,.2,.7,1]),space:'roi-original-pixels',encoding:'unit-float32'},result={matte,provenance};
 assert.equal(A.validateMatte(result,request),result);
 assert.throws(()=>A.validateMatte({...result,matte:{...matte,width:1}},request),/geometry/);
 assert.throws(()=>A.validateMatte({...result,provenance:{...provenance,modelVersion:'different'}},request),/provenance/);
 assert.throws(()=>A.validateMatte({...result,provenance:{...provenance,kind:'test-double'}},request),/provenance/);
 assert.throws(()=>A.validateMatte({...result,foreground:{data:new Uint8Array(16)}},request),/尚未接入/);
 assert.throws(()=>A.validateMatte({...result,matte:{...matte,data:new Float32Array([0,.2,Infinity,1])}},request),/probability/);
});
