'use strict';

// Independent offline audit. The math oracle below is authored separately from
// the reference core. UI tests execute shipped handlers with existing authored
// DOM/canvas/IPC doubles, never a browser, screenshot, model, or private photo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const R = require('../src/reference-compare.cjs');
const P = require('../src/project-document.cjs');
let nativeCanvas; try { nativeCanvas = require('@napi-rs/canvas'); } catch {}
const copy = value => structuredClone(value);
const plain = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const close = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function oracleLayout(view, image, pane) {
  const scale = Math.min(pane.width / image.width, pane.height / image.height) * view.zoom;
  return { width: image.width * scale, height: image.height * scale,
    left: pane.width / 2 - view.u * image.width * scale,
    top: pane.height / 2 - view.v * image.height * scale, scale };
}
function canvas(width = 13, height = 7, pixel = 91) {
  return { width, height, pixels: new Uint8ClampedArray(width * height * 4).fill(pixel), removed: false,
    remove() { this.removed = true; },
    getContext() { return { drawImage: source => { this.pixels = new Uint8ClampedArray(source.pixels); } }; } };
}
const provenance = (c, extra = {}) => ({ photoId: 'first', name: 'first.png', sourceRevision: 'first:source-0',
  mode: 'framed', generation: 17, viewToken: 3, recipeKey: '{"exposure":17}', width: c.width, height: c.height, ...extra });

test('independent reference math: normalized centers and fit scales match a separate oracle for mismatched aspect ratios', () => {
  const sizes = [{ width: 1280, height: 320 }, { width: 320, height: 1280 }, { width: 1, height: 1280 }, { width: 1279, height: 1280 }];
  const panes = [{ width: 450, height: 700 }, { width: 520, height: 223 }, { width: .001, height: 5 }, { width: 1, height: .001 }];
  for (const image of sizes) for (const pane of panes) for (const view of [{ u: .5, v: .5, zoom: 1 }, { u: .21, v: .83, zoom: 2.75 }, { u: 1, v: 0, zoom: 16 }]) {
    const expected = oracleLayout(view, image, pane), actual = R.layout(view, image, pane);
    assert.equal(actual.valid, true);
    for (const key of Object.keys(expected)) close(actual[key], expected[key], key);
    close((pane.width / 2 - actual.left) / actual.width, view.u);
    close((pane.height / 2 - actual.top) / actual.height, view.v);
  }
});

test('independent reference math: pan conversion is determined by the initiating pane, not shared pixel offsets', () => {
  const view = { u: .57, v: .39, zoom: 3.3 }, delta = { x: 41, y: -27 };
  const leftImage = { width: 1280, height: 320 }, rightImage = { width: 320, height: 1280 };
  const leftPane = { width: 600, height: 470 }, rightPane = { width: 430, height: 470 };
  for (const [image, pane] of [[leftImage, leftPane], [rightImage, rightPane]]) {
    const origin = oracleLayout(view, image, pane), next = R.pan(view, delta, image, pane);
    close(next.u, view.u - delta.x / origin.width); close(next.v, view.v - delta.y / origin.height);
    close(next.zoom, view.zoom);
    for (const [otherImage, otherPane] of [[leftImage, leftPane], [rightImage, rightPane]]) {
      const result = R.layout(next, otherImage, otherPane);
      close((otherPane.width / 2 - result.left) / result.width, next.u);
      close((otherPane.height / 2 - result.top) / result.height, next.v);
    }
  }
  assert.notEqual(R.pan(view, delta, leftImage, leftPane).u, R.pan(view, delta, rightImage, rightPane).u);
  assert.deepEqual(view, { u: .57, v: .39, zoom: 3.3 });
});

test('independent reference math: wheel anchoring preserves the initiating pixel at interior zoom and clamp limits', () => {
  for (const image of [{ width: 1200, height: 300 }, { width: 300, height: 1200 }]) for (const factor of [1.2, .8, 100, 1e-9]) {
    const pane = { width: 600, height: 440 }, view = { u: .5, v: .5, zoom: 3 }, anchor = { x: 311, y: 209 };
    const before = oracleLayout(view, image, pane), next = R.zoomAt(view, factor, anchor, image, pane), after = oracleLayout(next, image, pane);
    close((anchor.x - before.left) / before.width, (anchor.x - after.left) / after.width);
    close((anchor.y - before.top) / before.height, (anchor.y - after.top) / after.height);
    close(next.zoom, clamp(view.zoom * factor, 1, 16));
  }
});

test('independent reference math: zero, invalid and narrow panes never create non-finite layout or navigation', () => {
  const image = { width: 1280, height: 1280 };
  for (const pane of [{ width: 0, height: 0 }, { width: -1, height: 70 }, { width: NaN, height: 5 }, { width: Infinity, height: 5 }, { width: 1e-100, height: 1e-100 }]) {
    const view = { u: NaN, v: Infinity, zoom: -1 }, l = R.layout(view, image, pane);
    for (const v of Object.values(l)) if (typeof v === 'number') assert.ok(Number.isFinite(v));
    for (const result of [R.pan(view, { x: 1e200, y: -1e200 }, image, pane), R.zoomAt(view, 1e200, { x: -1e200, y: 1e200 }, image, pane)]) {
      assert.ok(Object.values(result).every(Number.isFinite)); assert.ok(result.u >= 0 && result.u <= 1 && result.v >= 0 && result.v <= 1 && result.zoom >= 1 && result.zoom <= 16);
    }
  }
  for (const factor of [NaN, Infinity, -1, 0]) assert.deepEqual(R.zoomAt(R.fitView(), factor, null, image, { width: 600, height: 400 }), R.fitView());
});

test('independent reference capture: pixels and provenance are independent of later source mutation', () => {
  const input = canvas(), meta = provenance(input), before = input.pixels.slice(); let made = 0;
  const frozen = R.capture(input, meta, () => { made++; return canvas(); }, () => true);
  assert.equal(made, 1); assert.notEqual(frozen.canvas, input); assert.notEqual(frozen.canvas.pixels.buffer, input.pixels.buffer);
  input.pixels.fill(3); meta.name = 'later.png'; meta.photoId = 'later';
  assert.deepEqual(frozen.canvas.pixels, before); assert.equal(frozen.name, 'first.png'); assert.equal(frozen.photoId, 'first');
  assert.equal(frozen.bytes, 13 * 7 * 4); assert.equal(Object.isFrozen(frozen), true);
  R.dispose(frozen); assert.equal(frozen.canvas.width, 0); assert.equal(frozen.canvas.height, 0); assert.equal(frozen.canvas.removed, true);
  assert.equal(input.width, 13); assert.equal(input.height, 7);
});

test('independent reference capture: dimensions and accepted state reject before allocation', () => {
  let allocations = 0; const create = () => { allocations++; return canvas(); };
  for (const [width, height] of [[0, 1], [-1, 1], [1.5, 1], [1281, 1], [1, 1281], [Infinity, 1], [1, NaN]]) {
    const input = { width, height }; assert.throws(() => R.capture(input, provenance(input), create, () => true));
  }
  const input = canvas();
  for (const patch of [{ mode: 'source' }, { mode: 'manual-source' }, { generation: NaN }, { generation: 1.5 }, { viewToken: Infinity }, { recipeKey: 'x'.repeat(R.LIMITS.maxRecipeChars + 1) }, { width: 12 }, { height: 6 }]) assert.throws(() => R.capture(input, provenance(input, patch), create, () => true));
  assert.throws(() => R.capture(input, provenance(input), create, () => false));
  assert.equal(allocations, 0); assert.equal(R.boundedSize(1280, 1280).bytes, 6.25 * 1024 * 1024);
});

test('independent reference capture: malformed identity provenance rejects before allocating or invoking coercion hooks', () => {
  let allocations = 0, hooks = 0; const input = canvas(), create = () => { allocations++; return canvas(); };
  for (const patch of [{ photoId: undefined }, { sourceRevision: undefined }, { photoId: '' }, { sourceRevision: '' }, { generation: -1 }, { viewToken: -1 }, { name: { toString() { hooks++; return 'forged.png'; } } }]) {
    assert.throws(() => R.capture(input, provenance(input, patch), create, () => true));
  }
  assert.equal(allocations, 0); assert.equal(hooks, 0);
});

test('independent reference capture: lost acceptance, size race and draw failure release only the staged candidate', () => {
  for (const fault of ['create-race', 'draw-race', 'size-race', 'throw']) {
    const input = canvas(), old = R.capture(input, provenance(input), () => canvas(), () => true); let current = true, staged;
    const create = () => {
      staged = canvas();
      if (fault === 'create-race') current = false;
      staged.getContext = () => ({ drawImage() {
        if (fault === 'throw') throw new Error('authored copy failure');
        if (fault === 'draw-race') current = false;
        if (fault === 'size-race') input.width++;
      } }); return staged;
    };
    assert.throws(() => R.capture(input, provenance(input), create, () => current));
    assert.equal(staged.width, 0); assert.equal(staged.height, 0); assert.equal(staged.removed, true);
    assert.equal(old.canvas.width, 13); assert.equal(old.canvas.height, 7); assert.equal(old.canvas.removed, false);
  }
});

test('independent reference recipe: key covers non-framing edits and nested recipes without mutating input', () => {
  const input = { exposure: 0, framing: null, localLayers: [{ id: 'layer', adjustments: { saturation: 3 }, enabled: true }], advancedTone: { curves: { red: [0, .25, .5, .75, 1] } } }, before = copy(input);
  const key = R.recipeKey(input);
  assert.equal(R.recipeKey({ advancedTone: input.advancedTone, localLayers: input.localLayers, framing: null, exposure: 0 }), key);
  for (const mutate of [x => x.exposure++, x => x.localLayers[0].adjustments.saturation++, x => x.advancedTone.curves.red[2] += .1]) { const candidate = copy(input); mutate(candidate); assert.notEqual(R.recipeKey(candidate), key); }
  assert.deepEqual(input, before);
});

test('independent reference recipe: dangerous objects fail closed without getters, toJSON or valueOf calls', () => {
  let hooks = 0; const accessor = { exposure: 0 }; Object.defineProperty(accessor, 'curve', { enumerable: true, get() { hooks++; return []; } });
  const cycle = {}; cycle.self = cycle; const hole = { values: Array(3) };
  for (const value of [accessor, cycle, hole, { x: NaN }, { x: Infinity }, { toJSON() { hooks++; return {}; } }, { valueOf() { hooks++; return 1; } }]) assert.throws(() => R.recipeKey(value));
  assert.equal(hooks, 0);
});

test('independent reference recipe: emitted key itself stays within the advertised character ceiling', () => {
  // Comma separators count toward output size, including each array separator.
  const parts = 1000, max = R.LIMITS.maxRecipeChars, payload = 'x'.repeat(max - 500 - parts * 2), input = { values: Array(parts).fill(''), tail: payload };
  const actualLength = JSON.stringify(input).length; assert.ok(actualLength > max, 'authored boundary counterexample must exceed the ceiling');
  assert.throws(() => R.recipeKey(input), /上限|过长|过大/);
});

// Reuse only the established authored environment, never the implementation
// owner's assertions. Inject the real new core before the actual app executes.
let environment;
function infrastructure() {
  if (!environment) {
    let text = fs.readFileSync(require.resolve('./photo-review-ui.test.cjs'), 'utf8');
    const end = text.indexOf("test('photo review UI:"); assert.ok(end > 0);
    text = text.slice(0, end)
      .replace('  let app=fs.readFileSync', "  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/reference-compare.cjs'),'utf8'),context); context.window.MintReferenceCompare=context.MintReferenceCompare;\n  let app=fs.readFileSync")
      .replace('ResizeObserver:class{observe(){}}', 'ResizeObserver:class{constructor(fn){this.fn=fn;}observe(element){(calls.resizeObservers||(calls.resizeObservers=[])).push({element,fn:this.fn});}}')
      .replace('setTimeout:(fn,delay)=>{if(delay===0)queueMicrotask(fn);return ++timer;},clearTimeout(){}', 'setTimeout:(fn,delay)=>{const id=++timer;(calls.timers||(calls.timers=new Map())).set(id,{fn,delay});if(delay===0&&!overrides.controlTimers)queueMicrotask(()=>{if(calls.timers.has(id)){calls.timers.delete(id);fn();}});return id;},clearTimeout:id=>calls.timers?.delete(id)');
    environment = new Function('require', '__dirname', text + '\nreturn {ready,flush,defer,until,key,realm,png,snapshot};')(require, __dirname);
  }
  return environment;
}
async function ui(options = {}) {
  const h = await infrastructure().ready(options);
  h.reference = vm.runInContext(`({pinReference,clearReference,setReferenceCompare,referenceCaptureReason,freshAcceptedRender,updateReferenceComparison,fitReference,zoomReference,positionReferencePanes,
    get:()=>({referenceSnapshot,referenceRequested,referenceSuspended,referencePointer,referenceRightCanvas,referenceViewState,acceptedRender,renderPending,renderFailure,renderVersion,renderingPhoto,renderTimer}),
    set:(value)=>{if('renderVersion'in value)renderVersion=value.renderVersion;if('referenceViewState'in value)referenceViewState=value.referenceViewState;}})`, h.context);
  h.activate(); await h.api.renderCurrent(); await infrastructure().flush();
  assert.equal(h.reference.referenceCaptureReason(), '', 'authored session must start with a finished accepted frame');
  return h;
}
function pinned(h) { assert.equal(h.fire('pinReference'), true); const value = h.reference.get().referenceSnapshot; assert.ok(value); return value; }
function gesture(h, pane = 'referencePane', id = 7, extra = {}) {
  h.fire(pane, 'pointerdown', { button: 0, pointerId: id, clientX: 330, clientY: 220, ...extra });
  assert.equal(h.reference.get().referencePointer?.id, id); assert.equal(h.get(pane).capture, id);
}
function assertReleased(h, pane = 'referencePane') { assert.equal(h.reference.get().referencePointer, null); assert.equal(h.get(pane).capture, null); assert.equal(h.get(pane).classes.has('dragging'), false); }

test('independent reference UI: same-frame tone debounce, in-flight and failed render cannot replace the old frozen copy', async () => {
  const h = await ui(), old = pinned(h), digest = hash(old.canvas.pixels), stamp = h.api.currentDisplayStamp();
  h.api.changeSettings({ exposure: 19 }); assert.equal(h.api.currentDisplayStamp(), stamp, 'reproduction must keep the legacy display stamp');
  assert.notEqual(h.reference.referenceCaptureReason(), ''); assert.equal(h.fire('replaceReference'), false);
  const pending = infrastructure().defer(); h.pipeline.render = () => pending.promise;
  const task = h.api.renderCurrent(); assert.equal(h.fire('replaceReference'), false);
  pending.reject(new Error('authored same-frame render failure')); await task;
  assert.match(h.reference.referenceCaptureReason(), /失败/); assert.equal(h.fire('replaceReference'), false);
  assert.equal(h.reference.get().referenceSnapshot, old); assert.equal(hash(old.canvas.pixels), digest);
  assert.equal(h.reference.get().referenceRightCanvas, null); assert.equal(h.get('referenceCurrentPixels').children.length, 0);
});

for (const change of ['recipe', 'nested recipe', 'photo identity', 'Blob identity', 'working canvas identity', 'source revision', 'generation', 'view token']) {
  test(`independent reference UI: accepted capture gate binds exact ${change}`, async () => {
    const h = await ui(), p = h.api.photos[0], old = pinned(h);
    if (change === 'recipe') p.settings.exposure = 9;
    if (change === 'nested recipe') p.settings.spots.push({ x: .5, y: .5, r: .01 });
    if (change === 'photo identity') h.api.photos[0] = { ...p };
    if (change === 'Blob identity') p.blob = new Blob([await p.blob.arrayBuffer()], { type: p.blob.type });
    if (change === 'working canvas identity') h.api.set({ source: h.canvas(100, 80) });
    if (change === 'source revision') p.sourceRevision += ':changed';
    if (change === 'generation') h.reference.set({ renderVersion: h.reference.get().renderVersion + 1 });
    if (change === 'view token') h.api.set({ viewToken: h.api.get().viewToken + 1 });
    assert.equal(h.reference.freshAcceptedRender(), false); assert.equal(h.fire('replaceReference'), false);
    assert.equal(h.reference.get().referenceSnapshot, old);
    h.reference.updateReferenceComparison(); assert.ok(h.reference.get().referenceRightCanvas === null, 'stale accepted pixels must not remain mounted after the full recipe or identity changes');
  });
}

test('independent reference UI: late older same-size output cannot supersede a newer accepted recipe', async () => {
  const h = await ui(), first = infrastructure().defer(), second = infrastructure().defer(); let calls = 0;
  h.pipeline.render = () => ++calls === 1 ? first.promise : second.promise;
  const older = h.api.renderCurrent(); h.api.changeSettings({ exposure: 21 }); const newer = h.api.renderCurrent();
  const a = h.canvas(100, 80), b = h.canvas(100, 80); a.pixels = new Uint8ClampedArray(100 * 80 * 4).fill(13); b.pixels = new Uint8ClampedArray(100 * 80 * 4).fill(223);
  second.resolve(b); await newer; const accepted = h.reference.get().acceptedRender;
  first.resolve(a); await older;
  assert.equal(h.reference.get().acceptedRender, accepted); assert.equal(h.api.get().rendered, b);
  const frozen = pinned(h); assert.equal(hash(frozen.canvas.pixels), hash(b.pixels)); assert.notEqual(hash(frozen.canvas.pixels), hash(a.pixels));
});

for (const mode of ['held original', 'wipe', 'manual tool', 'point tool', 'diagnostic overlay', 'local inspection', 'matte inspection', 'face boxes', 'crop draft']) {
  test(`independent reference UI: ${mode} cannot be captured or silently changed to permit capture`, async () => {
    const h = await ui(), old = pinned(h), p = h.api.photos[0];
    if (mode === 'held original') h.api.set({ originalHeld: true });
    if (mode === 'wipe') h.api.setCompare(true);
    if (mode === 'manual tool') h.api.setTool('selection-brush');
    if (mode === 'point tool') h.api.setTool('brush');
    if (mode === 'diagnostic overlay') p.settings.diagnosticOverlay = true;
    if (mode === 'local inspection') p.localInspect = true;
    if (mode === 'matte inspection') p.matteInspect = true;
    if (mode === 'face boxes') h.get('learnedFaceBoxes').checked = true;
    if (mode === 'crop draft') h.api.startCropDraft();
    const recipe = JSON.stringify(p.settings), previousTool = h.api.get().tool;
    assert.notEqual(h.reference.referenceCaptureReason(), ''); assert.equal(h.fire('replaceReference'), false);
    assert.equal(h.reference.get().referenceSnapshot, old); assert.equal(JSON.stringify(p.settings), recipe); assert.equal(h.api.get().tool, previousTool);
  });
}

test('independent reference UI: capture and all view operations preserve project bytes, complete histories, review, dirty baseline and export scope', async () => {
  const h = await ui(), p = h.api.photos[0]; h.get('exportScope').value = 'selected';
  await h.api.saveProject(); await infrastructure().flush(); await h.api.renderCurrent(); await infrastructure().flush();
  const before = await h.api.projectSnapshot(), encoded = await P.encode(copy(before)), fingerprint = h.api.projectFingerprint();
  const raw = new Uint8Array(await p.blob.arrayBuffer()), counters = { renders: h.calls.renders.length, models: h.calls.model, decodes: h.calls.decoded.length };
  const old = pinned(h), pixels = hash(old.canvas.pixels);
  h.fire('referencePane', 'wheel', { deltaY: -170, clientX: 330, clientY: 220 });
  gesture(h); h.fire('referencePane', 'pointermove', { pointerId: 7, clientX: 371, clientY: 193 }); h.fire('referencePane', 'pointerup', { pointerId: 7 });
  h.fire('referenceFit'); h.reference.setReferenceCompare(false); h.reference.setReferenceCompare(true);
  assert.equal(hash(old.canvas.pixels), pixels); h.fire('clearReference');
  assert.equal(h.api.projectFingerprint(), fingerprint); assert.deepEqual(plain(await h.api.projectSnapshot()), plain(before));
  assert.deepEqual(await P.encode(copy(await h.api.projectSnapshot())), encoded); assert.deepEqual(new Uint8Array(await p.blob.arrayBuffer()), raw);
  assert.equal(h.api.hasUnsavedProjectChanges(), false); assert.equal(h.get('exportScope').value, 'selected');
  assert.equal(h.calls.renders.length, counters.renders); assert.equal(h.calls.model, counters.models); assert.equal(h.calls.decoded.length, counters.decodes);
  assert.equal(old.canvas.width, 0); assert.equal(old.canvas.height, 0); assert.equal(h.get('referencePixels').children.length, 0);
});

test('independent reference UI: review-only metadata change is not incorrectly treated as a new pixel recipe', async () => {
  const h = await ui(), p = h.api.photos[0], count = h.calls.renders.length;
  h.api.applyPhotoReview(infrastructure().realm(h, { rating: 5 }), '', 'current');
  assert.equal(p.review.current.rating, 5); assert.equal(h.calls.renders.length, count); assert.equal(h.reference.referenceCaptureReason(), '');
  assert.equal(h.fire('pinReference'), true);
});

test('independent reference UI: failed copying or mounting retains old reference and releases the rejected candidate', async () => {
  for (const failure of ['copy', 'mount']) {
    const h = await ui(), old = pinned(h), fingerprint = h.api.projectFingerprint(); let created;
    const originalCreate = h.context.document.createElement;
    h.context.document.createElement = tag => { created = originalCreate(tag); if (tag === 'canvas' && failure === 'copy') created.getContext = () => ({ drawImage() { throw new Error('authored copy failure'); } }); return created; };
    if (failure === 'mount') {
      const host = h.get('referencePixels'), replace = host.replaceChildren.bind(host); let once = true;
      host.replaceChildren = (...children) => { if (once) { once = false; throw new Error('authored mount failure'); } return replace(...children); };
    }
    assert.equal(h.fire('replaceReference'), false); assert.equal(h.reference.get().referenceSnapshot, old);
    assert.equal(h.get('referencePixels').children[0], old.canvas); assert.equal(old.canvas.width, 100);
    assert.equal(created.width, 0); assert.equal(created.height, 0); assert.equal(h.api.projectFingerprint(), fingerprint);
  }
});

test('independent reference UI: a post-mount UI failure must not report failed replacement after destroying the previous reference', async () => {
  const h = await ui(), old = pinned(h), label = h.get('referenceMetadata'); let text = label.textContent, first = true;
  Object.defineProperty(label, 'textContent', { configurable: true, get() { return text; }, set(next) { if (first) { first = false; throw new Error('authored metadata display failure'); } text = next; } });
  assert.equal(h.fire('replaceReference'), false); assert.equal(h.reference.get().referenceSnapshot, old);
  assert.equal(old.canvas.width, 100); assert.equal(old.canvas.height, 80); assert.equal(h.get('referencePixels').children[0], old.canvas);
});

for (const outcome of ['dialog canceled', 'decode failed', 'replacement declined', 'staging failed', 'installation rolled back', 'committed']) {
  test(`independent reference UI: project ${outcome} obeys the reference commit boundary`, async () => {
    const bytes = await P.encode(infrastructure().snapshot('restored'));
    const h = await ui(), oldPhoto = h.api.photos[0], old = pinned(h), oldPixels = hash(old.canvas.pixels), oldFingerprint = h.api.projectFingerprint();
    const confirmation = infrastructure().defer(); let asked = false;
    h.bridge.openProject = async () => outcome === 'dialog canceled' ? { canceled: true } : { bytes: outcome === 'decode failed' ? new Uint8Array(80) : bytes, displayName: 'restored.mintproj' };
    h.bridge.confirmReplaceProject = async () => { asked = true; return confirmation.promise; };
    if (outcome === 'staging failed') h.pipeline.decodeImage = async () => { throw new Error('authored staged decode failure'); };
    if (outcome === 'installation rolled back') {
      const label = h.get('activeFileName'); let text = label.textContent, first = true;
      Object.defineProperty(label, 'textContent', { configurable: true, get() { return text; }, set(next) { if (first && next === 'restored.png') { first = false; throw new Error('authored installed view failure'); } text = next; } });
    }
    const opening = h.api.openProject();
    if (['replacement declined', 'installation rolled back', 'committed'].includes(outcome)) {
      await infrastructure().until(() => asked);
      assert.equal(h.reference.get().referenceSnapshot, old); assert.equal(old.canvas.width, 100); assert.equal(hash(old.canvas.pixels), oldPixels);
      confirmation.resolve(outcome !== 'replacement declined');
    }
    await opening; await infrastructure().flush();
    if (outcome === 'committed') {
      assert.equal(h.api.photos[0].id, 'restored'); assert.equal(h.reference.get().referenceSnapshot, null);
      assert.equal(old.canvas.width, 0); assert.equal(old.canvas.height, 0); assert.equal(h.get('referencePixels').children.length, 0);
    } else {
      assert.equal(h.api.photos[0], oldPhoto); assert.equal(h.reference.get().referenceSnapshot, old); assert.equal(hash(old.canvas.pixels), oldPixels);
      assert.equal(old.canvas.width, 100); assert.equal(old.canvas.height, 80); assert.equal(h.api.projectFingerprint(), oldFingerprint);
    }
  });
}

test('independent reference UI: switching/loading/failing current photo never pairs old pixels with a new current filename', async () => {
  const h = await ui(), old = pinned(h), next = h.photo('new-current'), pending = infrastructure().defer();
  const previousPixels = h.reference.get().referenceRightCanvas;
  h.pipeline.decodeImage = () => pending.promise;
  const switching = h.api.activatePhoto(next.id);
  assert.equal(h.get('referenceCurrentName').textContent, next.name); assert.equal(h.api.get().currentId, next.id);
  assert.equal(h.reference.get().referenceRightCanvas, null); assert.equal(h.get('referenceCurrentPixels').children.length, 0);
  assert.ok(!h.get('referenceCurrentPixels').children.includes(previousPixels)); assert.equal(h.reference.get().referenceSnapshot, old);
  pending.reject(new Error('authored decode failure')); await switching;
  assert.equal(h.reference.get().referenceRightCanvas, null); assert.equal(h.get('referenceCurrentPixels').children.length, 0);
  assert.equal(h.reference.get().referenceSnapshot, old); assert.match(h.get('referenceCurrentStatus').textContent, /未就绪|读取|等待|失败/);
});

test('independent reference UI: removal clears only its source photo; filter, switch and unrelated removal retain exact frozen pixels', async () => {
  const h = await ui(), sourcePhoto = h.api.photos[0], old = pinned(h), digest = hash(old.canvas.pixels), other = h.photo('other');
  h.api.setReviewView({ minRating: 5 }); assert.equal(h.reference.get().referenceSnapshot, old);
  await h.api.activatePhoto(other.id); await infrastructure().flush();
  assert.equal(h.reference.get().referenceSnapshot, old); assert.equal(hash(old.canvas.pixels), digest);
  sourcePhoto.selected = false; other.selected = true; h.api.removeSelected(); await infrastructure().flush();
  assert.equal(h.reference.get().referenceSnapshot, old); assert.equal(hash(old.canvas.pixels), digest);
  sourcePhoto.selected = true; h.api.removeSelected(); await infrastructure().flush();
  assert.equal(h.reference.get().referenceSnapshot, null); assert.equal(old.canvas.width, 0); assert.equal(old.canvas.height, 0);
});

for (const cause of ['pointercancel', 'lostpointercapture', 'wrong move', 'wrong up', 'another pane', 'second pointer', 'Escape', 'blur', 'pane resize', 'viewport resize', 'view switch', 'clear']) {
  test(`independent reference UI: ${cause} releases capture and stops later stale moves`, async () => {
    const h = await ui(); pinned(h); gesture(h);
    const state = plain(h.reference.get().referenceViewState);
    if (cause === 'pointercancel' || cause === 'lostpointercapture') h.fire('referencePane', cause, { pointerId: 7 });
    if (cause === 'wrong move') h.fire('referencePane', 'pointermove', { pointerId: 88, clientX: 400, clientY: 350 });
    if (cause === 'wrong up') h.fire('referencePane', 'pointerup', { pointerId: 88 });
    if (cause === 'another pane') h.fire('referenceCurrentPane', 'pointermove', { pointerId: 7, clientX: 400, clientY: 350 });
    if (cause === 'second pointer') h.fire('referencePane', 'pointerdown', { button: 0, pointerId: 88, clientX: 400, clientY: 350 });
    if (cause === 'Escape') infrastructure().key(h, 'Escape');
    if (cause === 'blur') h.events.get('blur')();
    if (cause === 'pane resize' || cause === 'viewport resize') h.calls.resizeObservers.find(o => o.element.id === (cause === 'pane resize' ? 'referencePane' : 'viewport')).fn();
    if (cause === 'view switch') h.reference.setReferenceCompare(false);
    if (cause === 'clear') h.fire('clearReference');
    assertReleased(h); h.fire('referencePane', 'pointermove', { pointerId: 7, clientX: 450, clientY: 360 });
    assert.deepEqual(plain(h.reference.get().referenceViewState), state);
  });
}

test('independent reference UI: real pan and wheel handlers use initiating-pane geometry and share normalized centers', async () => {
  const h = await ui(); pinned(h);
  const source = h.canvas(40, 120), p = h.api.photos[0]; p.originalWidth = 40; p.originalHeight = 120; h.api.set({ source });
  await h.api.renderCurrent(); await infrastructure().flush();
  const leftPane = { left: 20, top: 30, width: 460, height: 510 }, rightPane = { left: 510, top: 30, width: 310, height: 510 };
  h.get('referencePixels').getBoundingClientRect = () => leftPane; h.get('referenceCurrentPixels').getBoundingClientRect = () => rightPane;
  h.reference.set({ referenceViewState: { u: .5, v: .5, zoom: 3 } }); h.reference.positionReferencePanes();
  gesture(h, 'referenceCurrentPane');
  const initial = { u: .5, v: .5, zoom: 3 }, before = oracleLayout(initial, { width: 40, height: 120 }, rightPane);
  h.fire('referenceCurrentPane', 'pointermove', { pointerId: 7, clientX: 355, clientY: 205 }); h.fire('referenceCurrentPane', 'pointerup', { pointerId: 7 });
  let actual = h.reference.get().referenceViewState; close(actual.u, .5 - 25 / before.width); close(actual.v, .5 + 15 / before.height);
  for (const [holder, image, pane] of [['referencePixels', { width: 100, height: 80 }, leftPane], ['referenceCurrentPixels', { width: 40, height: 120 }, rightPane]]) {
    const element = h.get(holder).children[0], expected = oracleLayout(actual, image, pane);
    for (const field of ['width', 'height', 'left', 'top']) close(parseFloat(element.style[field]), expected[field]);
  }
  const anchor = { x: 163, y: 284 }, leftBefore = oracleLayout(actual, { width: 100, height: 80 }, leftPane), previous = plain(actual);
  h.fire('referencePane', 'wheel', { deltaY: -100, clientX: leftPane.left + anchor.x, clientY: leftPane.top + anchor.y });
  actual = h.reference.get().referenceViewState; const leftAfter = oracleLayout(actual, { width: 100, height: 80 }, leftPane);
  close((anchor.x - leftBefore.left) / leftBefore.width, (anchor.x - leftAfter.left) / leftAfter.width);
  close((anchor.y - leftBefore.top) / leftBefore.height, (anchor.y - leftAfter.top) / leftAfter.height); assert.ok(actual.zoom > previous.zoom);
});

test('independent reference UI: frozen RGBA survives later edits, undo and replacement without canvas aliasing', async () => {
  const h = await ui(), old = pinned(h), before = old.canvas.pixels.slice(), firstRendered = h.api.get().rendered;
  h.api.changeSettings({ exposure: 30 }); await h.api.renderCurrent(); await infrastructure().flush();
  const second = h.api.get().rendered; assert.notEqual(hash(second.pixels), hash(before)); assert.deepEqual(old.canvas.pixels, before);
  assert.notEqual(old.canvas, firstRendered); assert.notEqual(old.canvas, second);
  assert.equal(h.fire('replaceReference'), true); const replacement = h.reference.get().referenceSnapshot;
  assert.equal(hash(replacement.canvas.pixels), hash(second.pixels)); assert.equal(old.canvas.width, 0); assert.equal(old.canvas.height, 0);
  h.api.undo(); await infrastructure().flush(); await h.api.renderCurrent();
  assert.equal(hash(replacement.canvas.pixels), hash(second.pixels)); assert.notEqual(hash(replacement.canvas.pixels), hash(h.api.get().rendered.pixels));
});

test('independent reference UI: reference operations cannot change actual selected export targets, pixel results or original bytes', async () => {
  const h = await ui(), first = h.api.photos[0], hidden = h.photo('hidden-selected', { exposure: 13 }), notSelected = h.photo('not-selected', { temperature: 19 });
  notSelected.selected = false; h.get('exportScope').value = 'selected'; h.api.setReviewView({ minRating: 5 });
  const sourceHashes = await Promise.all(h.api.photos.map(async p => hash(new Uint8Array(await p.blob.arrayBuffer()))));
  await h.api.startExport(); await infrastructure().flush();
  const names = h.calls.writes.map(x => x.name), pixels = h.calls.encodes.map(c => hash(c.pixels)), targetIds = plain(h.api.get().exportQueue.items.map(item => item.photo.id));
  assert.deepEqual(targetIds, [first.id, hidden.id]); assert.equal(h.calls.writes.length, 2);
  await h.api.renderCurrent(); pinned(h); h.fire('referencePane', 'wheel', { deltaY: -100, clientX: 250, clientY: 300 });
  await h.api.startExport(); await infrastructure().flush();
  assert.deepEqual(h.calls.writes.slice(2).map(x => x.name), names); assert.deepEqual(h.calls.encodes.slice(2).map(c => hash(c.pixels)), pixels);
  assert.deepEqual(plain(h.api.get().exportQueue.items.map(item => item.photo.id)), targetIds);
  assert.deepEqual(await Promise.all(h.api.photos.map(async p => hash(new Uint8Array(await p.blob.arrayBuffer())))), sourceHashes);
  assert.equal(h.get('exportScope').value, 'selected'); assert.equal(notSelected.selected, false); assert.ok(h.reference.get().referenceSnapshot);
});

test('independent reference UI: source decode remains capped at 1280 and overbudget accepted canvases fail before snapshot allocation', async () => {
  const h = await ui(), other = h.photo('next'); await h.api.activatePhoto(other.id); await infrastructure().flush();
  assert.equal(h.calls.decoded.at(-1).max, 1280);
  h.api.set({ source: h.canvas(1281, 1) }); await h.api.renderCurrent(); await infrastructure().flush();
  // The final display layer now bounds expanded canvases; the snapshot guard
  // must still reject an independently malformed oversized accepted canvas.
  const accepted = h.reference.get().acceptedRender;
  assert.equal(accepted.canvas.width, 1280);
  accepted.canvas.width = 1281; accepted.width = 1281;
  let allocations = 0; const create = h.context.document.createElement;
  h.context.document.createElement = tag => { if (tag === 'canvas') allocations++; return create(tag); };
  assert.match(h.reference.referenceCaptureReason(), /1280|6.25/); assert.equal(h.fire('pinReference'), false); assert.equal(allocations, 0);
  assert.equal(h.reference.get().referenceSnapshot, null);
});

test('independent reference UI: empty-sized panes and nonfinite wheel/pointer input never inject nonfinite styles or keep gestures', async () => {
  const h = await ui(); pinned(h); h.get('referencePixels').getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
  h.fire('referencePane', 'wheel', { deltaY: Infinity, clientX: NaN, clientY: Infinity });
  h.fire('referencePane', 'pointerdown', { button: 0, pointerId: 9, clientX: 5, clientY: 5 }); assert.equal(h.reference.get().referencePointer, null);
  for (const value of Object.values(h.reference.get().referenceSnapshot.canvas.style)) if (typeof value === 'string') assert.doesNotMatch(value, /NaN|Infinity/);
  h.get('referencePixels').getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 500 });
  gesture(h); h.fire('referencePane', 'pointermove', { pointerId: 7, clientX: NaN, clientY: 5 }); assertReleased(h);
});

test('independent reference UI: page exit releases the sole session reference rather than persisting it', async () => {
  const h = await ui(), old = pinned(h); const before = plain(await h.api.projectSnapshot());
  h.events.get('pagehide')(); assert.equal(h.reference.get().referenceSnapshot, null); assert.equal(old.canvas.width, 0); assert.equal(old.canvas.height, 0);
  assert.deepEqual(plain(await h.api.projectSnapshot()), before);
});

test('independent reference native raster: all 256 alpha levels retain exact accepted RGBA after source repaint', { skip: !nativeCanvas && 'Installed native raster unavailable; no browser claim' }, async () => {
  const width = 257, height = 256, source = nativeCanvas.createCanvas(width, height), context = source.getContext('2d'), image = context.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) image.data.set([(x * 71 + y * 13) % 256, (x * 19 + y * 83) % 256, (x * 131 + y * 37) % 256, y], (y * width + x) * 4);
  context.putImageData(image, 0, 0);
  const read = c => c.getContext('2d').getImageData(0, 0, width, height).data;
  const accepted = new Uint8ClampedArray(read(source));
  const frozen = R.capture(source, provenance(source), () => nativeCanvas.createCanvas(1, 1), () => true);
  assert.deepEqual(read(frozen.canvas), accepted); assert.deepEqual(read(source), accepted);
  context.clearRect(0, 0, width, height); context.fillStyle = '#53a96d'; context.fillRect(0, 0, width, height);
  const frozenAfterMutation = new Uint8ClampedArray(read(frozen.canvas)), currentAfterMutation = new Uint8ClampedArray(read(source));
  assert.notEqual(hash(currentAfterMutation), hash(accepted)); assert.deepEqual(frozenAfterMutation, accepted);
  // @napi-rs/canvas 0.1.100 has an isolated conditional toBuffer discrepancy:
  // encoding source before copy, then repainting source before first frozen
  // encoding can produce a transparent PNG despite unchanged canvas readback.
  // Keep that diagnostic separate. Visual evidence encodes the sampled RGBA
  // through installed Sharp and independently decodes every resulting PNG.
  const sharp = require('sharp'), encode = rgba => sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } }).png().toBuffer();
  const nativeFrozenPNG = frozen.canvas.toBuffer('image/png');
  const nativeFrozenDecoded = await sharp(nativeFrozenPNG).ensureAlpha().raw().toBuffer();
  assert.equal(hash(nativeFrozenDecoded), hash(frozenAfterMutation), 'normal capture path without source pre-encoding must also encode the exact frozen pixels');
  const [acceptedPNG, frozenPNG, currentPNG] = await Promise.all([accepted, frozenAfterMutation, currentAfterMutation].map(encode));
  for (const [png, expected] of [[acceptedPNG, accepted], [frozenPNG, frozenAfterMutation], [currentPNG, currentAfterMutation]]) {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, width); assert.equal(info.height, height); assert.equal(info.channels, 4); assert.equal(hash(data), hash(expected));
  }
  // Opt-in artifacts are synthetic algorithm/raster evidence, not app screenshots.
  if (process.env.MINT_REFERENCE_INDEPENDENT_EVIDENCE === '1') {
    const path = require('node:path'), dir = path.join(__dirname, '../quality/reference-compare-qa'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'independent-synthetic-accepted.png'), acceptedPNG);
    fs.writeFileSync(path.join(dir, 'independent-synthetic-frozen-after-mutation.png'), frozenPNG);
    fs.writeFileSync(path.join(dir, 'independent-synthetic-current-after-mutation.png'), currentPNG);
    fs.writeFileSync(path.join(dir, 'independent-synthetic-evidence.json'), JSON.stringify({
      evidenceType: 'Synthetic native-raster algorithm evidence; NOT app screenshots or browser QA', width, height,
      alphaLevels: 256, acceptedRgbaSha256: hash(accepted), frozenAfterMutationRgbaSha256: hash(frozenAfterMutation),
      currentAfterMutationRgbaSha256: hash(currentAfterMutation), frozenMatchesAcceptedExactly: true,
      originalSourceRepaintCannotModifyFrozenReadback: true, rawReferenceBytes: frozen.bytes,
      visualEvidenceEncoder: 'Installed Sharp encoding actual canvas getImageData RGBA, each PNG independently decoded and verified',
      nativeCanvasVersion: require('@napi-rs/canvas/package.json').version,
      sourcePreEncodedBeforeCapture: false,
      nativeToBufferDecodedRgbaSha256: hash(nativeFrozenDecoded),
      nativeToBufferMatchesFrozenReadback: hash(nativeFrozenDecoded) === hash(frozenAfterMutation),
      separateNativeDiscrepancyRecord: 'independent-native-serialization.json: source pre-encoding can cause native PNG and subsequent drawImage consumption to disagree with readback. No browser/Electron DOM mount claim.'
    }, null, 2) + '\n');
  }
});

for (const operation of ['export', 'project', 'preset import', 'preset catalog']) for (const outcome of ['cancel', 'failure']) {
  test(`independent reference recovery: a queued preview consumed during ${operation} resumes after ${operation === 'preset catalog' && outcome === 'cancel' ? 'completion' : outcome} without manual rendering`, async () => {
    const h = await ui({ controlTimers: true }), old = pinned(h), pending = infrastructure().defer();
    h.api.changeSettings({ exposure: 31 });
    const scheduled = h.calls.timers.get(h.reference.get().renderTimer); assert.ok(scheduled); assert.equal(scheduled.delay, 70);
    // Save the real timer callback as an already-dequeued event, then start the
    // actual busy operation. No direct renderCurrent call is used below.
    let task;
    if (operation === 'export') { h.bridge.chooseExportFolder = () => pending.promise; task = h.api.startExport(); }
    if (operation === 'project') { h.bridge.openProject = () => pending.promise; task = h.api.openProject(); }
    if (operation === 'preset import') { h.bridge.importPreset = () => pending.promise; task = h.api.importNamedPreset(); }
    if (operation === 'preset catalog') { h.bridge.listPresets = () => pending.promise; task = h.api.loadNamedPresets(); }
    assert.equal(h.api.locked(), true); const callsBefore = h.calls.renders.length;
    scheduled.fn(); await infrastructure().flush();
    assert.equal(h.calls.renders.length, callsBefore); assert.equal(h.reference.get().renderTimer, null);
    assert.equal(h.reference.get().renderPending, true); assert.equal(h.reference.get().acceptedRender, null);
    if (outcome === 'failure') pending.reject(new Error('authored interrupted busy operation'));
    else pending.resolve(operation === 'project' ? { canceled: true } : operation === 'preset catalog' ? { items: [], trash: [] } : null);
    await task; await infrastructure().flush(); assert.equal(h.api.locked(), false);
    const resumedId = h.reference.get().renderTimer, resumed = h.calls.timers.get(resumedId);
    assert.ok(resumed, 'the real busy-operation completion must schedule a replacement preview'); assert.equal(resumed.delay, 0);
    h.calls.timers.delete(resumedId); resumed.fn(); await infrastructure().flush();
    assert.equal(h.calls.renders.length, callsBefore + 1); assert.equal(h.reference.get().renderPending, false);
    assert.equal(h.reference.referenceCaptureReason(), ''); assert.equal(h.reference.freshAcceptedRender(), true);
    assert.equal(h.reference.get().referenceSnapshot, old); assert.equal(h.reference.get().referenceRightCanvas, h.api.get().rendered);
  });
}

for (const outcome of ['cancellation', 'failed preflight']) {
  test(`independent reference recovery: interrupted preset application ${outcome} schedules its own fresh preview`, async () => {
    const h = await ui({ controlTimers: true }), p = h.api.photos[0], old = pinned(h);
    h.api.changeSettings({ exposure: 31 }); const scheduled = h.calls.timers.get(h.reference.get().renderTimer);
    const document = h.api.presetDocumentFromPhoto(p, 'authored pending recipe'); document.controls.basic.exposure = 42;
    h.api.stageNamedPreset(document, 'authored test'); h.get('namedPresetScope').value = 'current'; h.get('namedPresetMode').value = 'color';
    const task = h.api.applyNamedPreset(); assert.equal(h.api.get().presetOperation.kind, 'apply');
    const callsBefore = h.calls.renders.length; scheduled.fn(); await infrastructure().flush();
    assert.equal(h.reference.get().renderTimer, null); assert.equal(h.reference.get().renderPending, true); assert.equal(h.calls.renders.length, callsBefore);
    if (outcome === 'cancellation') h.api.cancelNamedPresetApplication(); else p.revision++;
    const frame = [...h.calls.timers].find(([, entry]) => entry.delay === 0); assert.ok(frame, 'real preflight nextFrame must be queued');
    h.calls.timers.delete(frame[0]); frame[1].fn(); await task; await infrastructure().flush();
    assert.equal(h.api.get().presetOperation, null); assert.equal(p.settings.exposure, 31, 'interrupted preset must not partly commit');
    const resumedId = h.reference.get().renderTimer, resumed = h.calls.timers.get(resumedId); assert.ok(resumed); assert.equal(resumed.delay, 0);
    h.calls.timers.delete(resumedId); resumed.fn(); await infrastructure().flush();
    assert.equal(h.calls.renders.length, callsBefore + 1); assert.equal(h.reference.get().renderPending, false);
    assert.equal(h.reference.referenceCaptureReason(), ''); assert.equal(h.reference.get().referenceSnapshot, old);
    assert.equal(h.reference.get().referenceRightCanvas, h.api.get().rendered);
  });
}
