'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {applyMaskStrokes,resampleMask}=require('../src/learned-analysis.cjs');
const source=()=>({width:20,height:20,data:new Float32Array(400).fill(.25)});
const stroke=(mode='keep',extra={})=>({mode,points:[{x:10.5,y:10.5}],radiusPx:4,hardness:.5,opacity:1,...extra});
test('manual keep/remove brushes retain immutable original alpha and every outside-support byte',()=>{
 for(const mode of ['keep','remove']){const mask=source(),snapshot=mask.data.slice(),out=applyMaskStrokes(mask,mask,[stroke(mode)]);
  assert.deepEqual(mask.data,snapshot);assert.equal(out.data[210],mode==='keep'?1:0);
  for(let y=0;y<20;y++)for(let x=0;x<20;x++)if(Math.hypot(x-10,y-10)>=4)assert.equal(out.data[y*20+x],snapshot[y*20+x]);
  assert.equal(out.correction.learned,false);assert.equal(out.correction.units,'original-pixels');}
});
test('per-stroke union prevents duplicate or oversampled points amplifying brush opacity',()=>{
 const mask=source(),s=stroke('keep',{opacity:.25}),a=applyMaskStrokes(mask,mask,[s]),b=applyMaskStrokes(mask,mask,[{...s,points:Array(20).fill({x:10.5,y:10.5})}]);
 assert.deepEqual(a.data,b.data);assert.equal(a.data[210],.4375);
});
test('a polyline paints continuously between pointer samples with a soft bounded edge',()=>{
 const m=source(),out=applyMaskStrokes(m,m,[stroke('remove',{points:[{x:4.5,y:10.5},{x:16.5,y:10.5}],hardness:0})]);
 assert.equal(out.data[210],0);assert.ok(out.data[230]>0&&out.data[230]<.25);
 for(const v of out.data)assert.ok(v>=0&&v<=1);
});
test('zero opacity, empty stroke list and undo replay are exactly lossless',()=>{
 const m=source();assert.deepEqual(applyMaskStrokes(m,m,[]).data,m.data);assert.deepEqual(applyMaskStrokes(m,m,[stroke('keep',{opacity:0})]).data,m.data);
 const edit=applyMaskStrokes(m,m,[stroke()]);assert.notDeepEqual(edit.data,m.data);assert.deepEqual(applyMaskStrokes(m,m,[]).data,m.data);
});
test('preview derives from corrected original and cannot change original stroke coordinates',()=>{
 const m=source(),s=stroke(),before=JSON.stringify(s),corrected=applyMaskStrokes(m,m,[s]);const preview=resampleMask(corrected,10,10);
 assert.equal(JSON.stringify(s),before);assert.equal(corrected.width,20);assert.equal(preview.width,10);assert.ok(preview.data[55]>.9);assert.equal(preview.data[0],.25);
});
test('wrong photo size, non-finite/out-of-image points, excessive strokes/complexity fail before edits',()=>{
 const m=source();assert.throws(()=>applyMaskStrokes(m,{width:10,height:10},[]),/original-size/);
 for(const s of [stroke('other'),stroke('keep',{radiusPx:0}),stroke('keep',{opacity:NaN}),stroke('keep',{points:[{x:NaN,y:2}]}),stroke('keep',{points:[{x:21,y:2}]})])assert.throws(()=>applyMaskStrokes(m,m,[s]));
 assert.throws(()=>applyMaskStrokes(m,m,Array(65).fill(stroke())),/64/);
 const big={width:1000,height:1000,data:new Float32Array(1000000)};
 assert.throws(()=>applyMaskStrokes(big,big,[stroke('keep',{radiusPx:500,points:Array.from({length:512},(_,i)=>({x:i%2?1000:0,y:i%2?1000:0}))})]),/复杂/);
});
