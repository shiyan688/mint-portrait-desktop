'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { ExportQueue } = require('../src/export-queue.cjs');
const defer = () => { let resolve,reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
const source = id => ({id,name:`${id}.png`,blob:new Blob(['source']),originalWidth:100,originalHeight:80,sourceRevision:`${id}:original`,settings:{exposure:2,spots:[]},learnedCache:new Map()});
const options = {mode:'original',format:'png',quality:.94};
const result = () => ({bytes:new Uint8Array([1,2,3]),width:100,height:80,originalWidth:100,originalHeight:80,scaled:false});
test('queue freezes detached settings but retains original Blob and no encoded bytes on receipts',async()=>{
  const p = source('a'), q = new ExportQueue([p],options); p.settings.exposure=90;p.settings.spots.push({x:.1});options.quality=.6;
  assert.equal(q.items[0].photo.blob,p.blob);assert.equal(q.items[0].photo.settings.exposure,2);assert.equal(q.items[0].photo.settings.spots.length,0);assert.ok(Object.isFrozen(q.items[0].photo.settings.spots));assert.equal(q.options.quality,.94);
  await q.run({render:async()=>result(),write:async()=>({filename:'a.png'})});assert.equal(q.items[0].state,'saved');assert.equal(q.items[0].bytes,undefined);assert.equal(q.items[0].output.bytes,undefined);
});
test('queue cancellation during rendering never writes and cancels every remaining item',async()=>{
  const entered=defer(),pending=defer(),q=new ExportQueue([source('a'),source('b')],options);let writes=0;
  const run=q.run({render:async()=>{entered.resolve();return pending.promise;},write:async()=>{writes++;}});await entered.promise;q.cancel();pending.resolve(result());await run;
  assert.equal(writes,0);assert.deepEqual(q.items.map(x=>x.state),['cancelled','cancelled']);assert.equal(q.running,false);
});
test('queue stop during write counts successful commit and retry never duplicates it',async()=>{
  const entered=defer(),pending=defer(),q=new ExportQueue([source('a'),source('b'),source('c')],options),writes=[];
  const write=async item=>{writes.push(item.photo.id);if(item.photo.id==='a'&&writes.length===1){entered.resolve();await pending.promise;}return {filename:item.photo.name};};
  const run=q.run({render:async()=>result(),write});await entered.promise;q.cancel();pending.resolve();await run;
  assert.deepEqual(q.items.map(x=>x.state),['saved','cancelled','cancelled']);assert.equal(q.summary().success,1);
  await q.run({render:async()=>result(),write,retry:true});assert.deepEqual(writes,['a','b','c']);assert.equal(q.summary().success,3);assert.deepEqual(q.items.map(x=>x.attempts),[1,1,1]);
});
test('queue failed commit remains failed even when stop was requested and retries only that failure',async()=>{
  const entered=defer(),pending=defer(),q=new ExportQueue([source('a'),source('b')],options),writes=[];
  const run=q.run({render:async()=>result(),write:async item=>{writes.push(item.photo.id);if(item.photo.id==='b'){entered.resolve();await pending.promise;}return {filename:item.photo.name};}});await entered.promise;q.cancel();pending.reject(new Error('disk full'));await run;
  assert.deepEqual(q.items.map(x=>x.state),['saved','failed']);assert.match(q.items[1].error,/disk full/);
  await q.run({render:async()=>result(),write:async item=>{writes.push(item.photo.id);return {};},retry:true});assert.deepEqual(writes,['a','b','b']);
});
test('queue continues after per-file render failures, single-flights, and does not rerun successes',async()=>{
  const q=new ExportQueue([source('a'),source('b'),source('c')],options),seen=[];
  const render=async item=>{seen.push(item.photo.id);if(item.photo.id==='b'&&item.attempts===1)throw new Error('unsupported geometry');return result();};
  await Promise.all([q.run({render,write:async()=>({})}),q.run({render,write:async()=>({})})]);assert.deepEqual(q.items.map(x=>x.state),['saved','failed','saved']);
  await q.run({render,write:async()=>({}),retry:true});assert.deepEqual(seen,['a','b','c','b']);assert.equal(q.summary().success,3);
});
test('queue browser download is not mislabeled as a saved native file or retried',async()=>{
  const q=new ExportQueue([source('a')],options);let writes=0;
  await q.run({render:async()=>result(),write:async()=>{writes++;return {downloaded:true};}});assert.equal(q.summary().saved,0);assert.equal(q.summary().downloaded,1);
  await q.run({render:async()=>result(),write:async()=>{writes++;},retry:true});assert.equal(writes,1);
});
