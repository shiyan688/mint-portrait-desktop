'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const P = require('../src/preview-pixel-inspector.cjs');
let native; try { native = require('@napi-rs/canvas'); } catch {}
const rect = (left = 0, top = 0, width = 100, height = 80) => ({ left, top, width, height });
const size = { width: 10, height: 8 };
const im = (values, width = values.length / 4, height = 1) => ({ width, height, data: new Uint8ClampedArray(values) });

test('preview inspector: CommonJS and script expose frozen matching APIs', () => {
  const c = vm.createContext({}); vm.runInContext(fs.readFileSync(require.resolve('../src/preview-pixel-inspector.cjs'), 'utf8'), c);
  assert.deepEqual(Object.keys(c.MintPreviewPixelInspector), Object.keys(P)); assert.equal(Object.isFrozen(P), true); assert.equal(Object.isFrozen(P.LIMITS), true);
  assert.equal(P.LIMITS.maxBytes, 6553600); assert.deepEqual(P.boundedSize(1280, 1280), { width:1280, height:1280, bytes:6553600 });
});
for (const [w,h] of [[0,1],[1,0],[-1,3],[1281,1],[1,1281],[1.5,3],['1',2],[NaN,2],[2,Infinity],[2,undefined],[Number.MAX_SAFE_INTEGER,1]]) test(`preview inspector rejects invalid dimensions ${w}/${h}`, () => assert.throws(() => P.boundedSize(w,h)));
test('preview inspector: half-open image AND viewport boundaries, letterbox, negative pan and fractional zoom', () => {
  const image = rect(20,10,50,40), view = rect(0,0,60,70);
  assert.deepEqual(P.mapPoint({x:20,y:10},image,view,size),{x:0,y:0});
  assert.deepEqual(P.mapPoint({x:59.999,y:49.999},image,view,size),{x:7,y:7});
  for(const p of [{x:19.999,y:20},{x:70,y:20},{x:40,y:50},{x:60,y:30},{x:50,y:-1}]) assert.equal(P.mapPoint(p,image,view,size),null);
  assert.deepEqual(P.mapPoint({x:0,y:0},rect(-50,-40,100,80),rect(),size),{x:5,y:4});
  assert.deepEqual(P.mapPoint({x:2.6,y:2},rect(.1,.2,5,4),rect(),size),{x:5,y:3});
});
test('preview inspector: randomized mapping matches independent interval oracle with no input mutation', () => {
  let seed=0x132abe; const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  for(let i=0;i<2000;i++) {
    const s={width:1+Math.floor(rnd()*1280),height:1+Math.floor(rnd()*1280)}, image=rect(rnd()*800-400,rnd()*600-300,rnd()*2000+1,rnd()*1000+1), view=rect(10,20,900,600), p={x:rnd()*1300-200,y:rnd()*1000-200};
    const before=structuredClone([s,image,view,p]);
    const inside=p.x>=Math.max(image.left,view.left)&&p.x<Math.min(image.left+image.width,view.left+view.width)&&p.y>=Math.max(image.top,view.top)&&p.y<Math.min(image.top+image.height,view.top+view.height);
    const out=P.mapPoint(p,image,view,s);
    assert.deepEqual(out,inside?{x:Math.floor((p.x-image.left)*s.width/image.width),y:Math.floor((p.y-image.top)*s.height/image.height)}:null);
    assert.deepEqual([s,image,view,p],before);
  }
});
test('preview inspector: exact RGBA reads, both endpoint sets, A0 hidden RGB and partial alpha', () => {
  const image=im([0,128,255,255,255,0,255,64,253,7,13,0,9,8,7,1],2,2), before=image.data.slice();
  assert.deepEqual(P.samplePixel(image,0,0),{x:0,y:0,r:0,g:128,b:255,a:255,alphaMode:'opaque',zeroChannels:['R'],fullChannels:['B']});
  assert.deepEqual(P.samplePixel(image,1,0),{x:1,y:0,r:255,g:0,b:255,a:64,alphaMode:'partial',zeroChannels:['G'],fullChannels:['R','B']});
  assert.deepEqual(P.samplePixel(image,0,1),{x:0,y:1,r:null,g:null,b:null,a:0,alphaMode:'transparent',zeroChannels:[],fullChannels:[]});
  assert.equal(P.samplePixel(image,1,1).a,1);assert.deepEqual(image.data,before);
  for(const [x,y] of [[-1,0],[2,0],[0,2],[.5,0],[0,NaN],['0',0]])assert.throws(()=>P.samplePixel(image,x,y));
});
test('preview inspector: own descriptors reject accessors, hidden/symbol/extra fields and inherited records without invocation', () => {
  let hits=0;const point={get x(){hits++;return 1;},y:2},hidden={x:1,y:2};Object.defineProperty(hidden,'secret',{value:3});
  for(const p of [point,hidden,{x:1,y:2,z:3},{x:1,y:2,[Symbol('x')]:1},Object.create({x:1,y:2}),new Date(),[1,2]]) assert.throws(()=>P.mapPoint(p,rect(),rect(),size));
  const image={width:1,height:1,get data(){hits++;return new Uint8Array(4);}};assert.throws(()=>P.samplePixel(image,0,0));
  const accessorRect={left:0,top:0,width:100,get height(){hits++;return 80;}};assert.throws(()=>P.mapPoint({x:1,y:2},accessorRect,rect(),size));
  assert.equal(hits,0);assert.deepEqual(P.mapPoint(Object.assign(Object.create(null),{x:0,y:0}),rect(),rect(),size),{x:0,y:0});
});
test('preview inspector: bounded native subarray and shadowed typed getters do not dispatch user code', () => {
  let hits=0;const data=new Uint8Array(new ArrayBuffer(20),4,4);data.set([11,22,33,44]);
  for(const key of ['length','buffer','byteLength','byteOffset'])Object.defineProperty(data,key,{get(){hits++;throw Error('must not execute');}});
  assert.equal(P.samplePixel({width:1,height:1,data},0,0).g,22);assert.equal(hits,0);
});
test('preview inspector: malformed native ownership, detached, SharedArrayBuffer and over-budget backing rejected', () => {
  class Subclass extends Uint8Array {}
  const detached=new Uint8Array(4);structuredClone(detached.buffer,{transfer:[detached.buffer]});
  const bad=[new Uint8Array(3),new Uint8Array(8),new Float32Array(4),new Uint16Array(4),[1,2,3,4],new DataView(new ArrayBuffer(4)),new Subclass(4),new Proxy(new Uint8Array(4),{}),detached,new Uint8Array(new ArrayBuffer(P.LIMITS.maxBytes+1),0,4)];
  if(typeof SharedArrayBuffer==='function')bad.push(new Uint8Array(new SharedArrayBuffer(4)));
  if(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable'))bad.push(new Uint8Array(new ArrayBuffer(4,{maxByteLength:8})));
  for(const data of bad)assert.throws(()=>P.samplePixel({width:1,height:1,data},0,0));
});
test('preview inspector: malformed finite geometry rejected rather than clamped', () => {
  for(const p of [{x:NaN,y:0},{x:Infinity,y:0},{x:'2',y:0},{x:1e8,y:0}])assert.throws(()=>P.mapPoint(p,rect(),rect(),size));
  for(const r of [rect(0,0,0,10),rect(0,0,-1,10),rect(0,0,Infinity,10),rect(1e8,0),rect(0,0,1e6,20)])assert.throws(()=>P.mapPoint({x:0,y:0},r,rect(),size));
});
test('preview inspector native Skia: samples real uncomposited readback and suppresses alpha zero',{skip:!native&&'Installed native canvas unavailable; no browser acceptance claim'},()=>{
  const canvas=native.createCanvas(4,2),ctx=canvas.getContext('2d'),data=ctx.createImageData(4,2);
  data.data.set([0,128,255,255,240,80,16,128,255,33,77,0,1,2,3,255,4,5,6,255,7,8,9,255,10,11,12,255,13,14,15,255]);ctx.putImageData(data,0,0);
  const read=ctx.getImageData(0,0,4,2),image={width:4,height:2,data:read.data},before=read.data.slice();
  const partial=P.samplePixel(image,1,0);assert.equal(partial.alphaMode,'partial');assert.deepEqual([partial.r,partial.g,partial.b,partial.a],Array.from(read.data.subarray(4,8)));
  assert.equal(P.samplePixel(image,2,0).r,null);assert.equal(P.samplePixel(image,3,1).b,15);assert.deepEqual(read.data,before);
});
test('preview inspector native Skia: bounded maximum 1280 readback remains single unchanged RGBA array',{skip:!native&&'Installed native canvas unavailable'},()=>{
  const canvas=native.createCanvas(1280,1280),ctx=canvas.getContext('2d');ctx.fillStyle='#12984a';ctx.fillRect(0,0,1280,1280);
  const data=ctx.getImageData(0,0,1280,1280).data,image={width:1280,height:1280,data};
  assert.deepEqual(P.samplePixel(image,1279,1279),{x:1279,y:1279,r:18,g:152,b:74,a:255,alphaMode:'opaque',zeroChannels:[],fullChannels:[]});assert.equal(image.data,data);
});
