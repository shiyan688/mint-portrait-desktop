'use strict';

// Independent adversarial audit. The actual app is executed unchanged in an
// authored DOM/IPC shell with installed NativeCanvas, not a browser/Electron.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('../quality/light-balance-qa/app-harness.cjs');
const Light = require('../src/light-balance.cjs');
const Project = require('../src/project-document.cjs');
const Local = require('../src/local-adjustments.cjs');
const Portrait = require('../src/portrait-engine.cjs');
const Levels = require('../src/levels.cjs');
const Text = require('../src/text-overlay.cjs');
const Padding = require('../src/canvas-padding.cjs');
const Export = require('../export-render-core.cjs');
const { sourceBytes } = require('../quality/text-qa/app-harness.cjs');

const copy = value => structuredClone(value);
const active = () => ({ version: 1, shadows: 37, highlights: -29, whiteBalance: { r: 1.12, g: .95, b: .84 } });
const flush = async () => { for (let n = 0; n < 24; n++) await Promise.resolve(); };
async function fresh(overrides = {}, settings = {}) {
  const h = harness(overrides);
  await flush();
  const p = h.activate(h.photo('audit', settings));
  h.api.updateAvailability();
  return { h, p };
}
function rgba(canvas) {
  return { width: canvas.width, height: canvas.height, data: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data };
}
function solid(h, rgb = [161, 137, 116]) {
  const c = h.api.get().source;
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${rgb.join(',')})`;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}
function point(h, type = 'pointerdown', extra = {}) {
  return h.fire('viewport', type, { pointerId: 7, button: 0, clientX: 500, clientY: 350, target: h.get('imageSurface'), ...extra });
}
function key(h, type, key, extra = {}) {
  h.events.get(type)({ key, code: key === ' ' ? 'Space' : key, target: {}, preventDefault() {}, ...extra });
}
async function ready(h) {
  h.fire('pickWhiteBalance');
  await h.api.renderCurrent();
  assert.equal(h.api.whiteBalanceFrameReady(), true);
}
function photoState(p) {
  return copy({ settings: p.settings, committed: p.committed, undo: p.undo, redo: p.redo, revision: p.revision });
}
function mesh() {
  // Authored synthetic topology, not detector output or a face-quality claim.
  const points = Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }));
  const oval = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
  oval.forEach((index, n) => { const a = n * 2 * Math.PI / oval.length; points[index] = { x: .5 + .29 * Math.sin(a), y: .5 - .4 * Math.cos(a), z: 0 }; });
  return points;
}

test('independent: sampler pixels include real healing/beauty/basic, exclude existing WB/Levels/text/geometry', async () => {
  const levels = Levels.defaults();
  levels.channels.blue.gamma = 1.6;
  const settings = {
    exposure: 12, contrast: 4, saturation: -8, temperature: 13,
    smooth: 28, brighten: 30, warmth: 20,
    spots: [{ x: .35, y: .4, r: .025 }], lightBalance: active(), levels,
    framing: { version: 1, crop: { x: .1, y: .1, w: .65, h: .7 }, quarterTurns: 1, flipX: true, flipY: false },
    canvasPadding: { ...Padding.defaults(), top: .1, right: .1 },
    textLayers: [{ id: 'audit-label', enabled: true, recipe: { ...Text.defaults(), text: 'NOT A SAMPLE', color: '#ff0000' } }]
  };
  const { h, p } = await fresh({}, settings);
  const skin = rgba(h.api.get().source);
  for (let n = 0; n < skin.width * skin.height; n++) {
    const noise = n % 7 - 3;
    skin.data.set([166 + noise, 137 + noise, 115 + noise, 255], n * 4);
  }
  h.api.get().source.pixels = skin.data;
  const before = rgba(h.api.get().source), beforeState = photoState(p);
  const landmarks = [mesh()];
  h.api.set({ analysis: { faceCount: 1, landmarks, mask: null } });
  let expected = Portrait.heal(before, { spots: settings.spots, strength: .86 });
  expected = Portrait.beauty(expected, p.settings, landmarks);
  expected = Local.tone(expected, p.settings);
  assert.notDeepEqual(expected.data, before.data, 'fixture must exercise upstream edits');
  assert.notDeepEqual(expected.data, Local.tone(before, p.settings).data, 'fixture must exercise beauty/healing, not basic alone');
  await ready(h);
  assert.deepEqual(rgba(h.api.get().rendered), expected);
  assert.deepEqual(photoState(p), beforeState, 'entering diagnostic mode must not commit');
  const wanted = Light.deriveWhiteBalance(expected, { x: .5, y: .5 });
  const rawGain = Light.deriveWhiteBalance(before, { x: .5, y: .5 });
  assert.notDeepEqual(wanted, rawGain, 'fixture must distinguish pre-stage from raw input');
  point(h); point(h, 'pointerup');
  assert.deepEqual(copy(p.settings.lightBalance.whiteBalance), wanted);
  assert.deepEqual(rgba(h.api.get().source), before);
  assert.equal(p.settings.lightBalance.shadows, 37);
  assert.deepEqual(copy(p.settings.framing), settings.framing);
  assert.equal(h.calls.model, 0, 'must not run new analysis');
});

test('independent: normalized sample location follows an offset/wide/tall CSS rectangle, not canvas/composite coordinates', async () => {
  for (const rect of [
    { left: 137, top: -81, width: 1600, height: 1280 },
    { left: -240, top: 260, width: 180, height: 720 },
    { left: 55, top: 100, width: 1100, height: 130 }
  ]) {
    const { h, p } = await fresh();
    const c = h.api.get().source, ctx = c.getContext('2d');
    for (const [x, y, rgb] of [[0, 0, [130, 125, 115]], [50, 0, [145, 120, 105]], [0, 40, [110, 132, 153]], [50, 40, [155, 148, 130]]]) {
      ctx.fillStyle = `rgb(${rgb.join(',')})`; ctx.fillRect(x, y, 50, 40);
    }
    await ready(h);
    h.get('imageSurface').getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height });
    const location = { x: .23, y: .68 };
    const wanted = Light.deriveWhiteBalance(rgba(c), location);
    const event = { clientX: rect.left + rect.width * location.x, clientY: rect.top + rect.height * location.y };
    point(h, 'pointerdown', event); point(h, 'pointerup', event);
    assert.deepEqual(copy(p.settings.lightBalance.whiteBalance), wanted);
    assert.equal(p.undo.length, 1);
  }
});

test('independent: enabling before/after comparison cancels WB mode and a pending sample', async () => {
  const { h, p } = await fresh(); solid(h);
  await ready(h); point(h);
  h.fire('compareView');
  assert.equal(h.api.get().tool, 'pan', 'comparison must not remain in hidden WB-input view');
  assert.equal(h.api.get().pointer, null);
  point(h, 'pointerup');
  assert.equal(p.undo.length, 0);
  assert.equal(p.settings.lightBalance, null);
  assert.equal(h.api.get().compare, true);
});

for (const interrupt of ['lostpointercapture', 'blur', 'space-release', 'second-pointer', 'cancel-button', 'fit', 'zoom']) {
  test(`independent: ${interrupt} invalidates pending sample even after pointerup is delivered again`, async () => {
    const { h, p } = await fresh({}, { lightBalance: active() }); solid(h);
    const before = photoState(p);
    await ready(h); point(h);
    if (interrupt === 'lostpointercapture') point(h, 'lostpointercapture');
    else if (interrupt === 'blur') h.events.get('blur')({});
    else if (interrupt === 'space-release') { key(h, 'keydown', ' '); key(h, 'keyup', ' '); }
    else if (interrupt === 'second-pointer') point(h, 'pointerdown', { pointerId: 8 });
    else if (interrupt === 'fit') h.api.fit();
    else if (interrupt === 'zoom') h.fire('viewport', 'wheel', { deltaY: -40, clientX: 500, clientY: 350 });
    else h.fire('cancelWhiteBalance');
    point(h, 'pointerup'); point(h, 'pointerup');
    assert.deepEqual(photoState(p), before);
    assert.equal(h.api.get().pointer, null);
  });
}

for (const stale of ['blob', 'source-object', 'generation', 'view-token', 'canvas', 'render-pending']) {
  test(`independent: a stale ${stale} cannot reuse the accepted neutral-patch frame`, async () => {
    const { h, p } = await fresh(); solid(h); await ready(h); point(h);
    const before = photoState(p);
    if (stale === 'blob') p.blob = new Blob([await p.blob.arrayBuffer()], { type: p.blob.type });
    else if (stale === 'source-object') h.api.set({ source: h.canvas(100, 80) });
    else if (stale === 'generation') h.api.set({ renderVersion: h.api.get().renderVersion + 1 });
    else if (stale === 'view-token') h.api.set({ viewToken: h.api.get().viewToken + 1 });
    else if (stale === 'canvas') h.api.get().acceptedRender.canvas = h.canvas(100, 80);
    else h.api.set({ renderPending: true });
    assert.equal(h.api.whiteBalanceFrameReady(), false);
    point(h, 'pointerup');
    assert.deepEqual(photoState(p), before);
  });
}

test('independent: a second pointerup and out-and-back drag cannot add duplicate or unintended edits', async () => {
  const { h, p } = await fresh(); solid(h); await ready(h);
  point(h); point(h, 'pointermove', { clientX: 540 }); point(h, 'pointermove'); point(h, 'pointerup');
  assert.equal(p.undo.length, 0, 'moving back is still a drag, not a click');
  point(h); point(h, 'pointerup');
  const after = photoState(p);
  point(h, 'pointerup'); point(h, 'lostpointercapture');
  assert.equal(p.undo.length, 1);
  assert.deepEqual(photoState(p), after);
});

test('independent: fixed-reference comparison leaves sampler and cancels its pending point', async () => {
  const { h, p } = await fresh(); solid(h);
  await h.api.renderCurrent();
  assert.equal(h.api.pinReference(), true);
  await ready(h); point(h);
  h.api.setReferenceCompare(true); point(h, 'pointerup');
  assert.equal(h.api.get().tool, 'pan');
  assert.equal(h.api.get().referenceRequested, true);
  assert.equal(p.settings.lightBalance, null); assert.equal(p.undo.length, 0);
});

test('independent: actual photo activation and undo/redo cancel stale samples without cross-photo history', async () => {
  const { h, p } = await fresh(); solid(h);
  h.api.changeSettings({ exposure: 5 });
  await ready(h); point(h); h.api.undo(); point(h, 'pointerup');
  assert.equal(p.settings.exposure, 0); assert.equal(p.settings.lightBalance, null); assert.equal(p.redo.length, 1);
  await ready(h); point(h); h.api.redo(); point(h, 'pointerup');
  assert.equal(p.settings.exposure, 5); assert.equal(p.settings.lightBalance, null); assert.equal(p.undo.length, 1);
  await ready(h); point(h);
  const other = h.photo('other-audit');
  await h.api.activatePhoto(other.id); point(h, 'pointerup');
  assert.equal(h.api.get().currentId, other.id); assert.equal(h.api.get().tool, 'pan');
  assert.equal(other.undo.length, 0); assert.equal(other.settings.lightBalance, null);
  assert.equal(p.undo.length, 1); assert.equal(p.settings.lightBalance, null);
});

test('independent: project save/open owns gains/history but never transient selection or diagnostic recipe', async () => {
  const { h, p } = await fresh({}, { exposure: 4, lightBalance: active() }); solid(h);
  const originalBytes = Buffer.from(await p.blob.arrayBuffer());
  await ready(h); point(h);
  await h.api.saveProject(); point(h, 'pointerup');
  assert.equal(h.calls.saved.length, 1);
  const document = await Project.decode(h.calls.saved[0].bytes);
  assert.deepEqual(document.photos[0].settings.lightBalance, active());
  assert.equal(document.photos[0].settings.exposure, 4);
  assert.deepEqual(Buffer.from(document.photos[0].source.bytes), originalBytes);
  assert.equal(document.photos[0].undo.length, 0);
  assert.doesNotMatch(JSON.stringify(document.photos[0].settings.lightBalance), /sample|coordinate|source|photo|pointer/i);
  const restored = await fresh({ bridge: { openProject: async () => ({ canceled: false, bytes: h.calls.saved[0].bytes, displayName: 'audit.mintproj' }) } });
  await restored.h.api.openProject(); await flush();
  const loaded = restored.h.api.photos[0];
  assert.deepEqual(copy(loaded.settings.lightBalance), active());
  assert.equal(restored.h.api.get().tool, 'pan');
  assert.equal(restored.h.api.lightState().whiteBalancePick, null);
  assert.equal(loaded.undo.length, 0);
});

test('independent: open export cancels pending WB and exports committed full settings, not its input-only view', async () => {
  const requests = [];
  const { h, p } = await fresh({ bridge: { renderExport: async payload => {
    requests.push(copy(payload));
    const validated = Export.validateRequest(copy(payload));
    return { bytes: sourceBytes, ...validated.plan };
  } } }, { exposure: 7, lightBalance: active() });
  solid(h); await ready(h); point(h);
  h.api.openExport(); point(h, 'pointerup');
  assert.equal(h.api.get().tool, 'pan');
  await h.api.startExport();
  assert.equal(requests.length, 1, JSON.stringify(h.api.get().exportQueue?.items.map(i => i.error)));
  assert.deepEqual(requests[0].settings.lightBalance, active());
  assert.equal(requests[0].settings.exposure, 7);
  assert.deepEqual(Buffer.from(requests[0].bytes), Buffer.from(await p.blob.arrayBuffer()));
  assert.equal(h.calls.writes.length, 1); assert.equal(p.undo.length, 0);
});

test('independent: active named preset applies atomically, drops old picker, and undo restores prior gains', async () => {
  const { h, p } = await fresh({}, { lightBalance: active(), smooth: 14 }); solid(h);
  h.api.set({ analysis: { faceCount: 1, landmarks: [mesh()], mask: null } });
  h.api.updateAvailability();
  const original = copy(p.settings.lightBalance);
  const document = h.api.presetDocumentFromPhoto(p, 'Independent light');
  document.controls.lightBalance = { ...active(), shadows: -21, whiteBalance: { r: .85, g: 1.1, b: 1.2 } };
  document.controls.basic.exposure = -6;
  h.api.stageNamedPreset(document, 'test');
  h.get('namedPresetMode').value = 'color';
  await ready(h); point(h);
  await h.api.applyNamedPreset(); point(h, 'pointerup');
  assert.deepEqual(copy(p.settings.lightBalance), copy(document.controls.lightBalance));
  assert.equal(p.settings.smooth, 14); assert.equal(p.settings.exposure, -6);
  assert.equal(h.api.get().tool, 'pan'); assert.equal(p.undo.length, 1);
  h.api.undo(); assert.deepEqual(copy(p.settings.lightBalance), original);
});

test('independent: nonzero upstream beauty without face facts fails closed, and losing facts prevents a pending sample', async () => {
  for (const control of ['smooth', 'brighten', 'warmth', 'underEye', 'redness', 'lip', 'blush']) {
    const { h, p } = await fresh({}, { [control]: 15 });
    const before = photoState(p);
    assert.equal(h.get('pickWhiteBalance').disabled, true, control);
    h.fire('pickWhiteBalance');
    assert.equal(h.api.get().tool, 'pan', control);
    assert.match(h.get('lightBalanceStatus').textContent, /修肤.*人脸/);
    assert.deepEqual(photoState(p), before);
  }
  const { h, p } = await fresh({}, { brighten: 10 }); solid(h);
  h.api.set({ analysis: { faceCount: 1, landmarks: [mesh()], mask: null } });
  h.api.updateAvailability(); await ready(h); point(h);
  h.api.set({ analysis: null });
  point(h, 'pointerup');
  assert.equal(p.settings.lightBalance, null); assert.equal(p.undo.length, 0);
});

test('independent: malformed/hidden/outside pointer geometry and right-click never creates a sample', async () => {
  for (const event of [{ clientX: NaN }, { clientY: Infinity }, { clientX: -1 }, { clientY: 701 }, { button: 2 }]) {
    const { h, p } = await fresh(); solid(h); await ready(h);
    point(h, 'pointerdown', event); point(h, 'pointerup', event);
    assert.equal(p.settings.lightBalance, null); assert.equal(p.undo.length, 0);
    assert.equal(h.api.get().pointer, null);
  }
  const { h, p } = await fresh(); solid(h); await ready(h);
  h.get('imageSurface').getBoundingClientRect = () => ({ left: 500, top: 350, width: 0, height: 0 });
  point(h); point(h, 'pointerup');
  assert.equal(p.settings.lightBalance, null); assert.equal(p.undo.length, 0);
});

test('independent: delayed old-photo input render cannot overwrite a newer accepted photo frame', async () => {
  const { h, p } = await fresh(); solid(h);
  // Deterministic timer shell: explicit render calls below own the exact race.
  h.context.setTimeout = () => 1;
  const base = h.pipeline.render;
  let release;
  h.pipeline.render = async (...args) => {
    const result = await base(...args);
    await new Promise(resolve => { release = resolve; });
    return result;
  };
  h.fire('pickWhiteBalance');
  const old = h.api.renderCurrent(); await flush();
  assert.equal(typeof release, 'function');
  const other = h.photo('race-other');
  await h.api.activatePhoto(other.id);
  h.pipeline.render = base;
  await h.api.renderCurrent();
  const accepted = h.api.get().acceptedRender;
  assert.equal(accepted.photo, other);
  release(); await old;
  assert.equal(h.api.get().acceptedRender, accepted);
  assert.equal(h.api.get().currentId, other.id);
  assert.equal(p.settings.lightBalance, null); assert.equal(other.settings.lightBalance, null);
});

test('independent: invalid active recipe cannot sample or edit but explicit whole-stage reset recovers', async () => {
  const { h, p } = await fresh({}, { lightBalance: { ...active(), whiteBalance: { r: 0, g: 1, b: 1 } } });
  assert.equal(h.get('shadowAmount').disabled, true);
  assert.equal(h.get('pickWhiteBalance').disabled, true);
  assert.equal(h.get('resetLightBalance').disabled, false);
  const before = photoState(p);
  h.api.editLightBalance(r => { r.shadows = 10; });
  assert.deepEqual(photoState(p), before);
  h.fire('resetLightBalance');
  assert.equal(p.settings.lightBalance, null); assert.equal(p.undo.length, 1);
});

test('independent: pure core and shipped worker preserve alpha and transparent RGB on adversarial gains', () => {
  const width = 67, height = 19;
  const input = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  for (let n = 0; n < width * height; n++) input.data.set([(n * 17) % 256, (n * 79) % 256, (n * 113) % 256, [0, 1, 17, 128, 254, 255][n % 6]], n * 4);
  const before = input.data.slice();
  for (const recipe of [Light.defaults(), { ...active(), shadows: -100, highlights: 100, whiteBalance: { r: 4, g: .25, b: 3.9 } }, { ...active(), shadows: 100, highlights: -100, whiteBalance: { r: .25, g: 4, b: .25 } }]) {
    const direct = Light.apply(input, recipe);
    const settings = { ...copy(Project.DEFAULT_SETTINGS), lightBalance: recipe };
    const native = Export.processPixels(input, settings, { sourceRevision: 'audit-source', landmarks: [] });
    assert.deepEqual(native, direct);
    let result;
    const c = vm.createContext({ self: { postMessage: value => { result = value; } }, inputJSON: JSON.stringify({ width, height, pixels: Array.from(input.data), settings, analysis: { sourceRevision: 'audit-source', landmarks: [] } }) });
    c.importScripts = (...names) => names.forEach(name => vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', name), 'utf8'), c));
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/pixel-worker.js'), 'utf8'), c);
    vm.runInContext('const i = JSON.parse(inputJSON); i.buffer = Uint8ClampedArray.from(i.pixels).buffer; delete i.pixels; self.onmessage({ data: i });', c);
    assert.equal(result.error, undefined);
    assert.deepEqual(new Uint8ClampedArray(result.buffer), direct.data);
    for (let i = 0; i < input.data.length; i += 4) {
      assert.equal(direct.data[i + 3], input.data[i + 3]);
      if (input.data[i + 3] === 0) assert.deepEqual(direct.data.slice(i, i + 4), input.data.slice(i, i + 4));
    }
  }
  assert.deepEqual(input.data, before);
});
