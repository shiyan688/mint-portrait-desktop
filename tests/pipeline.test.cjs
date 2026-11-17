'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const workerSource = fs.readFileSync(path.join(__dirname, '../src/pixel-worker.js'), 'utf8');
const engineSource = fs.readFileSync(path.join(__dirname, '../src/portrait-engine.cjs'), 'utf8');

function runPixels(image, settings, analysis = null) {
  let result;
  const context = vm.createContext({ Uint8ClampedArray, Uint8Array, Float32Array, Float64Array, ArrayBuffer, console });
  context.self = context;
  context.importScripts = (...filenames) => {
    for (const filename of filenames) {
      assert.ok(['./portrait-engine.cjs','./portrait-people.cjs','./portrait-people-desktop.cjs','./local-adjustments.cjs','./manual-tools.cjs','./manual-pipeline.cjs','./repair-brush-core.cjs','./advanced-tone.cjs','./levels.cjs','./light-balance.cjs','./geometry.cjs','./straighten.cjs','./perspective.cjs','./sharpness.cjs','./canvas-padding.cjs','./image-overlay.cjs','./image-layers.cjs','./redact-core.cjs','./redaction-layers.cjs'].includes(filename));
      vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',filename),'utf8'), context);
    }
  };
  context.postMessage = data => { result = data; };
  vm.runInContext(workerSource, context);
  const data = new Uint8ClampedArray(image.data);
  context.onmessage({ data: { width: image.width, height: image.height, buffer: data.buffer, settings, analysis } });
  if (result.error) throw new Error(result.error);
  return new Uint8ClampedArray(result.buffer);
}
function picture(width = 16, height = 16) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data.set([60 + x * 6, 70 + y * 6, 110 + ((x + y) % 4) * 8, 255], i);
  }
  return { width, height, data };
}

test('worker identity is exactly lossless and input is untouched', () => {
  const image = picture(); const before = image.data.slice();
  assert.deepEqual(runPixels(image, {}), before);
  assert.deepEqual(image.data, before);
});
test('face beauty and reshape never act without valid landmarks', () => {
  const image = picture();
  const settings = { smooth: 100, brighten: 100, warmth: 100, slim: 100, eyes: 100, nose: 100, jaw: 100 };
  assert.deepEqual(runPixels(image, settings, { faceCount: 0, landmarks: [] }), image.data);
  assert.deepEqual(runPixels(image, settings, { landmarks: [[{ x: 0.5, y: 0.5 }]] }), image.data);
});
test('multi-face worker sends one union beauty pass, never sequential brightening', () => {
  let calls=0, received, result;
  const context=vm.createContext({Uint8ClampedArray,ArrayBuffer,console});
  context.self=context;
  context.MintLocalAdjustments=require('../src/local-adjustments.cjs');context.MintStraighten=require('../src/straighten.cjs');context.MintSharpness=require('../src/sharpness.cjs');for(const file of ['image-overlay.cjs','image-layers.cjs'])vm.runInContext(fs.readFileSync(require.resolve('../src/'+file),'utf8'),context);
  context.importScripts=()=>{context.PortraitEngine={beauty:(im,settings,faces)=>{calls++;received=faces;return im;}}};
  context.postMessage=value=>{result=value;};
  vm.runInContext(workerSource,context);
  const face=Array.from({length:478},()=>({x:0.5,y:0.5}));
  const image=picture();
  context.onmessage({data:{width:image.width,height:image.height,buffer:image.data.slice().buffer,settings:{brighten:100},analysis:{landmarks:[face,face,face]}}});
  assert.equal(result.error,undefined);assert.equal(calls,1);assert.equal(received.length,3);
});
test('background never acts without a model confidence mask', () => {
  const image = picture();
  for (const bgMode of ['blur', 'color', 'transparent']) assert.deepEqual(runPixels(image, { bgMode, bgColor: '#ff0000', bgBlur: 50 }, { landmarks: [] }), image.data);
});
test('exposure is monotonic, deterministic and preserves alpha', () => {
  const image = picture(); image.data[3] = 0; image.data[7] = 120;
  const brighter = runPixels(image, { exposure: 30 });
  const darker = runPixels(image, { exposure: -30 });
  assert.deepEqual(brighter, runPixels(image, { exposure: 30 }));
  for (let i = 0; i < image.data.length; i += 4) {
    assert.equal(brighter[i + 3], image.data[i + 3]);
    assert.equal(darker[i + 3], image.data[i + 3]);
    if (image.data[i + 3]) {
      for (let c = 0; c < 3; c++) { assert.ok(brighter[i + c] >= image.data[i + c]); assert.ok(darker[i + c] <= image.data[i + c]); }
    }
  }
  assert.deepEqual(brighter.slice(0, 4), image.data.slice(0, 4));
});
test('zero saturation produces grayscale and temperature shifts red/blue', () => {
  const image = picture();
  const gray = runPixels(image, { saturation: -100 });
  const warm = runPixels(image, { temperature: 25 });
  const cool = runPixels(image, { temperature: -25 });
  for (let i = 0; i < gray.length; i += 4) {
    assert.equal(gray[i], gray[i + 1]); assert.equal(gray[i], gray[i + 2]);
    assert.ok(warm[i] > cool[i]); assert.ok(warm[i + 2] < cool[i + 2]);
  }
});
test('transparent segmentation uses real supplied confidence and preserves foreground', () => {
  const image = picture(3, 1);
  const mask = { width: 3, height: 1, data: new Float32Array([0, 0.5, 1]), maxValue: 1 };
  const out = runPixels(image, { bgMode: 'transparent', bgFeather: 0 }, { mask });
  assert.equal(out[3], 0); assert.equal(out[7], 128); assert.equal(out[11], 255);
  assert.deepEqual(mask.data, new Float32Array([0, 0.5, 1]));
});
test('color compositing changes background while keeping confident foreground intact', () => {
  const image = picture(2, 1);
  const mask = { width: 2, height: 1, data: new Float32Array([0, 1]) };
  const out = runPixels(image, { bgMode: 'color', bgColor: '#09c', bgFeather: 0 }, { mask });
  assert.deepEqual([...out.slice(0, 4)], [0, 153, 204, 255]);
  assert.deepEqual(out.slice(4), image.data.slice(4));
});
test('manual normalized blemish spots change pixels without needing a face', () => {
  const image = picture(64, 64);
  const center = (32 * 64 + 32) * 4; image.data.set([0, 0, 0, 255], center);
  const out = runPixels(image, { spots: [{ x: 32 / 63, y: 32 / 63, r: 0.035 }] });
  assert.ok(out[center] > image.data[center]);
});
test('invalid image buffers are rejected by worker', () => {
  assert.throws(() => runPixels({ width: 2, height: 2, data: new Uint8ClampedArray(2) }, {}), /无效/);
});

// Unit-only DOM/Worker doubles exercise lifecycle behavior, not browser inference.
function lifecycleHarness() {
  const workers = [];
  class TestImageData {
    constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
  }
  class TestCanvas {
    constructor(width = 16, height = 16) { this.width = width; this.height = height; this.pixels = null; }
    getContext() {
      return {
        getImageData: () => new TestImageData(this.pixels?.slice() || new Uint8ClampedArray(this.width * this.height * 4), this.width, this.height),
        putImageData: data => { this.pixels = data.data.slice(); }
      };
    }
  }
  class TestWorker {
    constructor() { this.terminated = false; workers.push(this); }
    postMessage(input) {
      this.input = input;
      this.timer = setTimeout(() => { if (!this.terminated) this.onmessage({ data: { width: input.width, height: input.height, buffer: input.buffer } }); }, 12);
    }
    terminate() { this.terminated = true; clearTimeout(this.timer); }
  }
  const context = vm.createContext({
    console, URL, DOMException, Uint8ClampedArray, Float32Array, Number, Object, Array,
    setTimeout, clearTimeout, queueMicrotask, structuredClone,
    document: { createElement: () => new TestCanvas() },
    Worker: TestWorker, ImageData: TestImageData,
    FaceLandmarker: {}, ImageSegmenter: {}, FilesetResolver: {}
  });
  const source = fs.readFileSync(path.join(__dirname, '../src/pipeline.js'), 'utf8')
    .replace(/^import .*;$/m, '')
    .replace(/export /g, '')
    .replace(/import\.meta\.url/g, JSON.stringify('http://localhost/src/pipeline.js'));
  vm.runInContext(`${source}\nglobalThis.api = { DEFAULT_SETTINGS, PRESETS, render, cancelRenders };`, context);
  return { api: context.api, workers, canvas: new TestCanvas() };
}

test('render lifecycle caps workers at two and preserves immutable default settings', async () => {
  const { api, workers, canvas } = lifecycleHarness();
  const jobs = Array.from({ length: 5 }, () => api.render(canvas));
  assert.equal(workers.length, 2);
  const outputs = await Promise.all(jobs);
  assert.equal(workers.length, 5);
  assert.ok(workers.every(worker => worker.terminated));
  assert.ok(outputs.every(output => output.width === 16 && output !== canvas));
  assert.equal(Object.isFrozen(api.DEFAULT_SETTINGS), true);
  assert.equal(Object.isFrozen(api.DEFAULT_SETTINGS.spots), true);
});
test('AbortSignal cancels queued work without allocating a worker and cancels running work', async () => {
  const { api, workers, canvas } = lifecycleHarness();
  const a = new AbortController(), c = new AbortController();
  const first = api.render(canvas, {}, null, { signal: a.signal }).catch(error => error.name);
  const second = api.render(canvas);
  const third = api.render(canvas, {}, null, { signal: c.signal }).catch(error => error.name);
  assert.equal(workers.length, 2);
  c.abort(); a.abort();
  assert.equal(await first, 'AbortError');
  assert.equal(await third, 'AbortError');
  await second;
  assert.equal(workers.length, 2);
  assert.ok(workers.every(worker => worker.terminated));
  const recovery = await api.render(canvas);
  assert.equal(recovery.width, 16);
});
test('cancelRenders rejects every queued/running job and later renders still work', async () => {
  const { api, workers, canvas } = lifecycleHarness();
  const jobs = Array.from({ length: 5 }, () => api.render(canvas).catch(error => error.name));
  api.cancelRenders();
  assert.deepEqual(await Promise.all(jobs), Array(5).fill('AbortError'));
  assert.equal(workers.length, 2);
  assert.ok(workers.every(worker => worker.terminated));
  assert.equal((await api.render(canvas)).width, 16);
});
test('already aborted render starts no worker', async () => {
  const { api, workers, canvas } = lifecycleHarness();
  const abort = new AbortController(); abort.abort();
  await assert.rejects(api.render(canvas, {}, null, { signal: abort.signal }), { name: 'AbortError' });
  assert.equal(workers.length, 0);
});

test('manual editing view strips only ephemeral stale background/auto geometry, never saved settings', async () => {
 const h=lifecycleHarness(),s={...h.api.DEFAULT_SETTINGS,bgMode:'transparent',learnedMatteId:'unavailable',slim:18,eyes:9,nose:3,jaw:-4,exposure:11};
 await assert.rejects(h.api.render(h.canvas,s,{sourceRevision:'p'}),/缺失/);
 await h.api.render(h.canvas,s,{sourceRevision:'p'},{manualEditing:true});
 assert.equal(h.workers[0].input.settings.bgMode,'original');assert.equal(h.workers[0].input.settings.learnedMatteId,null);
 for(const key of ['slim','eyes','nose','jaw'])assert.equal(h.workers[0].input.settings[key],0);
 assert.equal(h.workers[0].input.settings.exposure,11);assert.equal(s.bgMode,'transparent');assert.equal(s.slim,18);assert.equal(s.learnedMatteId,'unavailable');
});
