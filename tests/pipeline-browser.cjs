'use strict';
// Full offline integration test, including real MediaPipe CPU/WASM inference.
// Run: node tests/pipeline-browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/codex/cua_node/lib/node_modules/playwright')); }
const root = path.resolve(__dirname, '..');
const mime = { '.js': 'application/javascript', '.cjs': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.html': 'text/html' };
const requests = [];
const errors = [];
const server = http.createServer(async (request, response) => {
  requests.push(request.url);
  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html');
    return response.end('<!doctype html><meta charset="utf-8"><title>Offline pipeline test</title>');
  }
  try {
    const resolved = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!resolved.startsWith(root + path.sep)) throw new Error('Invalid path');
    response.setHeader('Content-Type', mime[path.extname(resolved)] || 'application/octet-stream');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(await fs.readFile(resolved));
  } catch { response.writeHead(404).end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, chromiumSandbox: true, ignoreDefaultArgs: ['--enable-unsafe-swiftshader','--unsafely-disable-devtools-self-xss-warnings','--no-sandbox','--disable-setuid-sandbox'], args: ['--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', event => { if (process.env.DEBUG_PIPELINE) console.log('browser:', event.type(), event.text()); });
    await page.goto(base);
    const result = await page.evaluate(async () => {
      const api = await import('/src/pipeline.js');
      const logs = [];
      const ready = await api.initModels(message => logs.push(message));
      const demoBlob = await (await fetch('/assets/demo.png')).blob();
      const decoded = await api.decodeImage(demoBlob);
      const original = decoded.canvas.getContext('2d').getImageData(0, 0, decoded.width, decoded.height).data;
      const analysis = await api.analyze(decoded.canvas);
      const min = analysis.mask.data.reduce((a, b) => Math.min(a, b), 1);
      const max = analysis.mask.data.reduce((a, b) => Math.max(a, b), 0);
      const identity = await api.render(decoded.canvas, api.DEFAULT_SETTINGS, analysis);
      const identityPixels = identity.getContext('2d').getImageData(0, 0, identity.width, identity.height).data;
      let identityDifference = 0;
      for (let i = 0; i < original.length; i++) identityDifference += Math.abs(identityPixels[i] - original[i]);
      const settings = { ...api.DEFAULT_SETTINGS, smooth: 55, brighten: 30, eyes: 20, slim: 25, exposure: 5, bgMode: 'color', bgColor: '#88bb99' };
      const edited = await api.render(decoded.canvas, settings, analysis);
      const editedPixels = edited.getContext('2d').getImageData(0, 0, edited.width, edited.height).data;
      let editedDifference = 0;
      for (let i = 0; i < original.length; i++) editedDifference += Math.abs(editedPixels[i] - original[i]);
      const transparent = await api.render(decoded.canvas, { ...api.DEFAULT_SETTINGS, bgMode: 'transparent', bgFeather: 0 }, analysis);
      const transparentPixels = transparent.getContext('2d').getImageData(0, 0, transparent.width, transparent.height).data;
      let transparentCount = 0, opaqueCount = 0;
      for (let i = 3; i < transparentPixels.length; i += 4) { if (transparentPixels[i] < 32) transparentCount++; if (transparentPixels[i] > 240) opaqueCount++; }
      const png = await api.encode(transparent, 'png');
      const jpg = await api.encode(transparent, 'jpeg');
      const flattened = await api.decodeImage(new Blob([jpg], { type: 'image/jpeg' }));
      const blank = document.createElement('canvas'); blank.width = 160; blank.height = 160;
      blank.getContext('2d').fillStyle = '#d5d8dc'; blank.getContext('2d').fillRect(0, 0, 160, 160);
      const blankAnalysis = await api.analyze(blank);
      const blankEdited = await api.render(blank, { ...api.DEFAULT_SETTINGS, smooth: 100, brighten: 100, warmth: 100, slim: 100, eyes: 100, nose: 100, jaw: 100 }, blankAnalysis);
      const blankPixel = [...blankEdited.getContext('2d').getImageData(80, 80, 1, 1).data];
      const smaller = await api.decodeImage(demoBlob, 128);
      const controller = new AbortController();
      const cancel = api.render(decoded.canvas, settings, analysis, { signal: controller.signal }).then(() => 'unexpected-success', error => error.name);
      controller.abort();
      const cancelled = await cancel;
      const afterCancel = await api.render(decoded.canvas, api.DEFAULT_SETTINGS, analysis);
      let unsupported = false;
      try { await api.encode(afterCancel, 'tiff'); } catch (error) { unsupported = error instanceof RangeError; }
      return {
        ready, logs, width: decoded.width, height: decoded.height, originalWidth: decoded.originalWidth,
        faceCount: analysis.faceCount, points: analysis.landmarks[0]?.length,
        maskWidth: analysis.mask.width, maskHeight: analysis.mask.height, min, max,
        identityDifference, editedDifference, transparentCount, opaqueCount,
        png: [...png.slice(0, 8)], jpg: [...jpg.slice(0, 3)], jpgPixel: [...flattened.canvas.getContext('2d').getImageData(0, 0, 1, 1).data],
        noFaceCount: blankAnalysis.faceCount, blankPixel,
        smallerWidth: smaller.width, smallerScaled: smaller.scaled,
        cancelled, afterCancelWidth: afterCancel.width, unsupported,
        maskStillValid: analysis.mask.data.length === analysis.mask.width * analysis.mask.height,
        inputStillValid: decoded.canvas.width === decoded.width
      };
    });
    assert.equal(result.ready.delegate, 'CPU');
    assert.ok(result.faceCount >= 1, 'Demo must detect a real face');
    assert.equal(result.points, 478);
    assert.ok(result.min < 0.15 && result.max > 0.85, 'Mask must contain real foreground and background probabilities');
    assert.equal(result.identityDifference, 0);
    assert.ok(result.editedDifference > 10000);
    assert.ok(result.transparentCount > 100 && result.opaqueCount > 100);
    assert.deepEqual(result.png, [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.deepEqual(result.jpg, [255, 216, 255]);
    assert.equal(result.jpgPixel[3], 255);
    assert.equal(result.noFaceCount, 0);
    assert.deepEqual(result.blankPixel, [213, 216, 220, 255], 'No-face beauty and geometry must be a no-op');
    assert.equal(result.smallerWidth, 128);
    assert.equal(result.smallerScaled, true);
    assert.equal(result.cancelled, 'AbortError');
    assert.equal(result.afterCancelWidth, result.width);
    assert.ok(result.unsupported && result.maskStillValid && result.inputStillValid);
    assert.deepEqual(errors, []);
    assert.ok(requests.some(url => url.endsWith('.wasm')));
    assert.ok(requests.some(url => url.endsWith('face_landmarker.task')));
    assert.ok(requests.some(url => url.endsWith('selfie_segmenter.tflite')));
    console.log(JSON.stringify({ status: 'PASS', realCPUInference: true, offlineOnly: true, result, assetRequests: requests }, null, 2));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
