'use strict';
// Rehashed historical frames must not inherit newly introduced v16 fields.
function historicalImageFields(doc) {
  if (doc.format === 'mint-portrait-project' && doc.version < 16) for (const photo of doc.photos) {
    delete photo.imageAssets;
    for (const state of [photo.settings, photo.committed, ...photo.undo, ...photo.redo, photo.exportedSettings].filter(Boolean)) delete state.imageLayers;
  }
  return doc;
}


// Independent, offline contract audit. These tests deliberately use a separately
// written reference model and correctly rehashed on-disk counterexamples.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const sharp = require('sharp');
const R = require('../src/photo-review.cjs');
const P = require('../src/project-document.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const copy = value => structuredClone(value);
const current = (rating = 0, flag = 'none', label = 'none') => ({ rating, flag, label });
const record = (id, name, review = R.defaults(), selected = true) => ({ id, name, review, selected });
const full = () => ({ version: 1, current: current(3, 'pick', 'blue'),
  undo: Array.from({ length: 40 }, (_, i) => current(i % 6, i % 2 ? 'reject' : 'none', 'red')),
  redo: Array.from({ length: 40 }, (_, i) => current((i + 3) % 6, i % 2 ? 'pick' : 'none', 'purple')) });
function frozen(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
function modelEdit(state, patch) {
  const s = copy(state), n = { ...s.current, ...patch };
  if (Object.keys(n).some(k => n[k] !== s.current[k])) {
    s.undo = [...s.undo, s.current].slice(-40); s.current = n; s.redo = [];
  }
  return s;
}
function modelHistory(state, direction) {
  const s = copy(state), from = direction, to = direction === 'undo' ? 'redo' : 'undo';
  if (s[from].length) { s[to] = [...s[to], s.current].slice(-40); s.current = s[from].pop(); }
  return s;
}
// Unlike production, tokenize and compare integer runs through BigInt.
function compareNames(a, b) {
  const x = a.match(/[0-9]+|[^0-9]/g) || [], y = b.match(/[0-9]+|[^0-9]/g) || [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const bothNumbers = /^[0-9]+$/.test(x[i]) && /^[0-9]+$/.test(y[i]);
    const av = bothNumbers ? BigInt(x[i]) : x[i], bv = bothNumbers ? BigInt(y[i]) : y[i];
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return x.length - y.length;
}
function expectedQuery(records, view) {
  const sorted = records.map((r, index) => ({ ...r, index })).sort((a, b) => {
    const primary = view.sort === 'name' ? compareNames(a.name, b.name)
      : view.sort === 'rating-asc' ? a.review.current.rating - b.review.current.rating
      : view.sort === 'rating-desc' ? b.review.current.rating - a.review.current.rating : 0;
    return primary || a.index - b.index;
  });
  const visible = r => { const c = r.review.current; return c.rating >= view.minRating && c.rating <= view.maxRating
    && (view.flag === 'all' || view.flag === c.flag) && (view.label === 'all' || view.label === c.label)
    && !(view.hideRejected && c.flag === 'reject'); };
  const ids = fn => sorted.filter(fn).map(r => r.id);
  const out = { orderedIds: ids(() => true), visibleIds: ids(visible), selectedIds: ids(r => r.selected),
    visibleSelectedIds: ids(r => r.selected && visible(r)), hiddenSelectedIds: ids(r => r.selected && !visible(r)),
    rejectedSelectedIds: ids(r => r.selected && r.review.current.flag === 'reject') };
  out.counts = { total: sorted.length, visible: out.visibleIds.length, hidden: sorted.length - out.visibleIds.length,
    selected: out.selectedIds.length, visibleSelected: out.visibleSelectedIds.length, hiddenSelected: out.hiddenSelectedIds.length,
    rejected: sorted.filter(r => r.review.current.flag === 'reject').length, rejectedSelected: out.rejectedSelectedIds.length };
  return out;
}
async function projectFixture(count = 1) {
  const pixels = Buffer.from(Array.from({ length: 6 * 4 * 4 }, (_, i) => (i * 71 + 19) % 256));
  const bytes = new Uint8Array(await sharp(pixels, { raw: { width: 6, height: 4, channels: 4 } }).png().toBuffer());
  const settings = { ...copy(P.DEFAULT_SETTINGS), exposure: 13, temperature: -7 };
  return { version: 6, currentId: 'independent-0', photos: Array.from({ length: count }, (_, i) => ({
    id: 'independent-' + i, name: 'Audit ' + i + '.png', sourceRevision: 'original:' + i,
    source: { bytes: new Uint8Array(bytes), mime: 'image/png', width: 6, height: 4, sha256: sha(bytes) },
    selected: i % 3 !== 0, settings: copy(settings), committed: copy(settings), undo: [{ ...copy(settings), exposure: -9 }],
    redo: [{ ...copy(settings), exposure: 26 }], revision: i + 17, preset: null, learnedCache: [], review: full()
  })) };
}
function rehashFile(bytes, transform, rawTransform = value => value) {
  const h = P.inspectHeader(bytes), parsed = JSON.parse(Buffer.from(bytes.subarray(64, 64 + h.metadataBytes)).toString('utf8'));
  transform(parsed);
  const json = Buffer.from(rawTransform(JSON.stringify(historicalImageFields(parsed)))), payload = Buffer.from(bytes.subarray(64 + h.metadataBytes));
  const header = Buffer.from(bytes.subarray(0, 64));
  header.writeUInt32LE(parsed.version, 8); header.writeUInt32LE(json.length, 16);
  header.writeUInt32LE(64 + json.length + payload.length, 24); Buffer.from(sha(json), 'hex').copy(header, 32);
  const out = Buffer.concat([header, json, payload]);
  assert.equal(P.inspectHeader(out).metadataSha256, sha(json), 'counterexample must have a valid digest');
  return out;
}

test('independent review: all result snapshots are pairwise owned even when input aliases every history', () => {
  const shared = current(4, 'reject', 'purple'), input = frozen({ version: 1, current: shared, undo: Array(40).fill(shared), redo: Array(40).fill(shared) });
  for (const result of [R.validate(input), R.edit(input, { rating: 4 }), R.edit(input, { flag: 'pick' }), R.undo(input), R.redo(input)]) {
    const snapshots = [result.current, ...result.undo, ...result.redo];
    assert.equal(new Set(snapshots).size, snapshots.length); assert.ok(snapshots.every(s => s !== shared));
    result.current.rating = 2; result.undo[0].flag = 'none';
    assert.equal(shared.rating, 4); assert.equal(shared.flag, 'reject');
  }
});

test('independent review: no-op with two saturated stacks retains redo; branch and inverse match a separate model', () => {
  let production = full(), reference = full();
  const before = copy(production); production = R.edit(production, { rating: 3, label: 'blue' });
  assert.deepEqual(production, before); assert.equal(production.redo.length, 40);
  for (let i = 0; i < 370; i++) {
    const op = i % 11;
    if (op < 6) { const patch = { rating: (i * 7) % 6, flag: ['pick', 'none', 'reject'][i % 3] }; production = R.edit(production, patch); reference = modelEdit(reference, patch); }
    else { const direction = op < 9 ? 'undo' : 'redo'; production = R[direction](production); reference = modelHistory(reference, direction); }
    assert.deepEqual(production, reference, 'model mismatch at command ' + i);
  }
});

test('independent review: inherited numeric setters cannot intercept output arrays or trigger missing-index reads', () => {
  const sandbox = vm.createContext({}); vm.runInContext(fs.readFileSync(require.resolve('../src/photo-review.cjs'), 'utf8'), sandbox);
  const result = vm.runInContext(`(() => {
    let calls = 0, rejected = 0;
    const absent = MintPhotoReview.defaults(); absent.undo.length = 1;
    Object.defineProperty(Array.prototype, '0', { configurable: true, get() { calls++; throw Error('read'); }, set() { calls++; throw Error('write'); } });
    try {
      try { MintPhotoReview.validate(absent); } catch (e) { if (e instanceof TypeError) rejected++; else throw e; }
      const edited = MintPhotoReview.edit(MintPhotoReview.defaults(), { rating: 5 });
      const q = MintPhotoReview.query([{ id: 'p1', name: 'a.png', review: edited, selected: true }], MintPhotoReview.viewDefaults());
      return JSON.stringify({ calls, rejected, undo: edited.undo.length, selected: q.selectedIds[0] });
    } finally { delete Array.prototype[0]; }
  })()`, sandbox);
  assert.deepEqual(JSON.parse(result), { calls: 0, rejected: 1, undo: 1, selected: 'p1' });
});

test('independent review: cycles, forged scalars, own accessors and hidden full-history fields fail without user hooks', () => {
  let hooks = 0;
  const badStates = [];
  const cycle = R.defaults(); cycle.undo.push(cycle); badStates.push(cycle);
  const circularCurrent = R.defaults(); circularCurrent.current.rating = circularCurrent; badStates.push(circularCurrent);
  const accessor = full(); Object.defineProperty(accessor.redo[39], 'label', { enumerable: true, get() { hooks++; return 'blue'; } }); badStates.push(accessor);
  const hidden = full(); Object.defineProperty(hidden.undo[39], 'rating', { enumerable: false }); badStates.push(hidden);
  const forged = full(); forged.current.rating = { valueOf() { hooks++; return 4; }, toJSON() { hooks++; return 4; } }; badStates.push(forged);
  const custom = full(); Object.setPrototypeOf(custom.current, { rating: 3 }); badStates.push(custom);
  for (const state of badStates) {
    for (const op of ['validate', 'undo', 'redo']) assert.throws(() => R[op](state), TypeError);
    assert.throws(() => R.query([record('bad', 'bad.png', state)], { ...R.viewDefaults(), flag: 'none', maxRating: 0 }), TypeError);
  }
  assert.equal(hooks, 0);
});

test('independent review: natural numeric equivalence resumes at suffix and preserves import ties beyond safe integers', () => {
  const names = ['a0002b11', 'a2b2', 'a002b02', 'a2b0002', 'a00002', 'a2', 'a' + '9'.repeat(200), 'a1' + '0'.repeat(200), 'A10', 'A2', 'a0b', 'a00a', 'a0a', 'a😀2', 'a😀10', 'a\ud8002'];
  const records = frozen(names.map((name, i) => record('name-' + i, name)));
  const query = R.query(records, { ...R.viewDefaults(), sort: 'name' });
  assert.deepEqual(query.orderedIds, expectedQuery(records, { ...R.viewDefaults(), sort: 'name' }).orderedIds);
  assert.deepEqual(query.orderedIds.filter(id => ['name-1', 'name-2', 'name-3'].includes(id)), ['name-1', 'name-2', 'name-3']);
  assert.ok(query.orderedIds.indexOf('name-6') < query.orderedIds.indexOf('name-7'));
});

test('independent review: 100 maximum-history photos obey independent filter/sort model without dropping hidden selections', () => {
  const records = frozen(Array.from({ length: 100 }, (_, i) => {
    const review = full(); review.current = current(i % 6, ['none', 'pick', 'reject'][Math.floor(i / 6) % 3], ['none', 'red', 'yellow', 'green', 'blue', 'purple'][Math.floor(i / 3) % 6]);
    return record('p' + i, ['frame0002b', 'frame2a', 'frame10', 'frame2a', 'frame1'][i % 5], review, i % 4 !== 0);
  }));
  for (const sort of ['import', 'name', 'rating-asc', 'rating-desc']) for (const flag of ['all', 'none', 'pick', 'reject']) for (const hideRejected of [false, true]) {
    const view = { ...R.viewDefaults(), minRating: 2, maxRating: 4, flag, hideRejected, sort };
    const actual = R.query(records, view); assert.deepEqual(actual, expectedQuery(records, view));
    assert.equal(actual.counts.selected, 75); assert.equal(new Set([...actual.visibleSelectedIds, ...actual.hiddenSelectedIds]).size, 75);
    if (flag === 'reject' && hideRejected) { assert.equal(actual.counts.visible, 0); assert.equal(actual.counts.hiddenSelected, 75); }
  }
  assert.equal(records.filter(r => r.selected).length, 75);
});

test('independent review: output arrays never alias each other or alter input, including all-visible selected case', () => {
  const records = [record('p1', 'a.png'), record('p2', 'b.png')], original = copy(records), q = R.query(records, R.viewDefaults());
  const arrays = Object.values(q).filter(Array.isArray); assert.equal(new Set(arrays).size, arrays.length);
  q.visibleSelectedIds.splice(0, 2, 'fake'); q.counts.selected = 99;
  assert.deepEqual(q.selectedIds, ['p1', 'p2']); assert.deepEqual(q.visibleIds, ['p1', 'p2']); assert.deepEqual(records, original);
  assert.throws(() => R.query([...records, record('p1', 'different.png')], R.viewDefaults()), /Duplicate/);
});

test('independent project review: complete 100-photo saturation roundtrip preserves source hashes and all pixel histories', async () => {
  const input = await projectFixture(100), before = copy(input), encoded = await P.encode(input), output = await P.decode(encoded);
  assert.equal(output.photos.length, 100); assert.ok(P.inspectHeader(encoded).metadataBytes < P.LIMITS.maxMetadataBytes);
  for (let i = 0; i < 100; i++) {
    const actual = output.photos[i], expected = before.photos[i]; assert.deepEqual(actual.review, expected.review);
    for (const key of ['settings', 'committed', 'undo', 'redo', 'sourceRevision', 'revision', 'selected', 'name']) assert.deepEqual(actual[key], expected[key]);
    assert.equal(sha(actual.source.bytes), expected.source.sha256); assert.equal(actual.source.sha256, expected.source.sha256);
  }
  assert.deepEqual(input, before); output.photos[0].review.undo[39].rating = 5;
  assert.notEqual(output.photos[1].review.undo[39].rating, 5); assert.deepEqual(input, before);
});

test('independent project review: schema1–5 migrations preserve original settings and bytes, adding only neutral review', async () => {
  const input = await projectFixture(2), encoded = await P.encode(input);
  for (const version of [1, 2, 3, 4, 5]) {
    const old = rehashFile(encoded, d => { d.version = version; d.photos.forEach(p => delete p.review); });
    const digest = sha(old), output = await P.decode(old); assert.equal(output.version, P.VERSION); assert.equal(sha(old), digest);
    output.photos.forEach((p, i) => {
      assert.deepEqual(p.review, R.defaults()); assert.equal(p.source.sha256, input.photos[i].source.sha256);
      assert.equal(sha(p.source.bytes), input.photos[i].source.sha256);
      for (const key of ['settings', 'committed', 'undo', 'redo', 'revision', 'selected']) assert.deepEqual(p[key], input.photos[i][key]);
    });
    output.photos[0].review.current.rating = 5; assert.equal(output.photos[1].review.current.rating, 0);
    await assert.rejects(P.decode(rehashFile(encoded, d => { d.version = version; })), /review/);
  }
});

test('independent project review: rehashed malformed review cannot hide in an unselected last photo or far history', async () => {
  const input = await projectFixture(3), bytes = await P.encode(input);
  const mutations = [
    p => { delete p.review; }, p => { p.review = null; }, p => { p.review.current.rating = '5'; },
    p => { p.review.redo[39].label = 'Blue'; }, p => { p.review.undo[39].extra = 1; },
    p => { p.review.undo = Array(41).fill(current()); }, p => { p.review.current.selected = false; },
    p => { p.review.current.flag = 'all'; }, p => { p.review.redo[39] = []; }, p => { p.review.undo[39].rating = -1; }
  ];
  for (const mutate of mutations) await assert.rejects(P.decode(rehashFile(bytes, d => { const p = d.photos[2]; p.selected = false; mutate(p); })), /review/i);
  const missingWrite = copy(input); delete missingWrite.photos[2].review;
  assert.deepEqual((await P.decode(await P.encode(missingWrite))).photos[2].review, R.defaults());
});

test('independent project review: correctly hashed duplicate review keys and altered original identity still fail', async () => {
  const input = await projectFixture(), bytes = await P.encode(input);
  await assert.rejects(P.decode(rehashFile(bytes, () => {}, s => s.replace('"rating":3', '"rating":3,"rating":4'))), /Noncanonical|duplicate/);
  await assert.rejects(P.decode(rehashFile(bytes, d => { d.photos[0].source.sha256 = '0'.repeat(64); })), /identity/);
  const wrong = copy(input); wrong.photos[0].source.sha256 = '0'.repeat(64); await assert.rejects(P.encode(wrong), /identity/);
});

test('independent project review: all nested review getter slots reject before hash and without execution', async () => {
  let getterCalls = 0, hashes = 0;
  const locations = [p => [p, 'review'], p => [p.review, 'undo'], p => [p.review.current, 'label'], p => [p.review.undo, '39'], p => [p.review.redo[39], 'flag']];
  for (const locate of locations) {
    const input = await projectFixture(), [object, key] = locate(input.photos[0]);
    Object.defineProperty(object, key, { enumerable: true, configurable: true, get() { getterCalls++; throw Error('unexpected getter'); } });
    await assert.rejects(P.encode(input, { sha256: bytes => { hashes++; return sha(bytes); } }), /review|Accessors/);
  }
  assert.equal(getterCalls, 0); assert.equal(hashes, 0);
});

// Reuse ONLY the authored DOM/canvas/IPC infrastructure, not the UI owner's test
// cases. New assertions below drive the shipped app handlers. These are not
// native-browser, native-dialog, screenshot or model-inference tests.
let infrastructure;
function uiInfrastructure() {
  if (!infrastructure) {
    const source = fs.readFileSync(require.resolve('./photo-review-ui.test.cjs'), 'utf8');
    const boundary = source.indexOf("test('photo review UI:");
    assert.ok(boundary > 0, 'UI test harness must have an explicit first-test boundary');
    infrastructure = new Function('require', '__dirname', source.slice(0, boundary) + '\nreturn { ready, realm, edit, setReview, key, defer, flush, until, stage, presetDoc, authoredMesh };')(require, __dirname);
  }
  return infrastructure;
}

for (const race of ['same-ID replacement', 'array reorder', 'review history only', 'source Blob replacement']) {
  test(`independent review UI: ${race} during approval aborts every staged metadata edit`, async () => {
    const { ready, edit, setReview, realm } = uiInfrastructure(); let mutate = () => {};
    const h = await ready({ confirm: () => { mutate(); return true; } });
    const a = h.activate(h.photo('stable-a')), b = h.photo('stable-b'); setReview(h, b, { flag: 'reject' });
    mutate = () => {
      if (race === 'same-ID replacement') h.api.photos[1] = { ...b };
      if (race === 'array reorder') h.api.photos.reverse();
      if (race === 'review history only') b.review.undo.push(realm(h, current(2)));
      if (race === 'source Blob replacement') b.blob = new Blob(['replacement'], { type: 'image/png' });
    };
    edit(h, { rating: 5 }, 'selected');
    assert.equal(h.calls.scopeConfirm.length, 1); assert.equal(a.review.current.rating, 0); assert.equal(b.review.current.rating, 0);
    assert.equal(a.revision, 0); assert.equal(b.revision, 0); assert.match(h.get('toast').textContent, /已改变/);
  });
}

test('independent review UI: throwing or truthy non-boolean confirmation never authorizes a hidden batch', async () => {
  const { ready, setReview, edit } = uiInfrastructure();
  for (const answer of [1, 'true', {}, new Boolean(true), 'throw']) {
    const h = await ready({ confirm: () => { if (answer === 'throw') throw Error('dialog unavailable'); return answer; } });
    const a = h.activate(), b = h.photo('reject'); setReview(h, b, { flag: 'reject' });
    edit(h, { rating: 4 }, 'selected'); assert.equal(a.review.current.rating, 0); assert.equal(b.review.current.rating, 0);
    assert.equal(a.revision, 0); assert.equal(b.revision, 0); assert.equal(h.calls.scopeConfirm.length, 1);
  }
});

test('independent review UI: a committed first export remains success when scope changes, and retry never duplicates it', async () => {
  const { ready, defer, until, setReview } = uiInfrastructure(); const write = defer(); let writeCount = 0;
  const h = await ready({ bridge: { writeExport: async payload => { writeCount++; h.calls.writes.push(payload); return writeCount === 1 ? write.promise : { filename: payload.name }; } } });
  const a = h.activate(h.photo('first')), b = h.photo('second');
  const running = h.api.startExport(); await until(() => writeCount === 1);
  setReview(h, b, { flag: 'reject' }); write.resolve({ filename: 'first_committed.png' }); await running;
  const queue = h.api.get().exportQueue; assert.equal(queue.items[0].state, 'saved'); assert.equal(queue.items[1].state, 'failed');
  assert.equal(queue.items[0].receipt.filename, 'first_committed.png'); assert.equal(writeCount, 1);
  assert.match(queue.items[1].error, /已改变/);
  await h.api.startExport(null, true);
  assert.equal(writeCount, 2); assert.equal(queue.summary().saved, 2); assert.equal(queue.items[0].attempts, 1); assert.equal(queue.items[1].attempts, 2);
  assert.equal(h.calls.scopeConfirm.length, 1); assert.match(h.calls.scopeConfirm[0], /共 1 张/); assert.match(h.calls.scopeConfirm[0], /已标拒绝 1 张/);
  assert.equal(a.blob, queue.items[0].photo.blob);
});

test('independent review UI: history-only change during real asynchronous preset preflight cancels all candidate pixels', async () => {
  const { ready, defer, until, stage, presetDoc, authoredMesh, realm } = uiInfrastructure(); const pending = defer();
  const h = await ready({ pipeline: { analyze: () => pending.promise } }); const a = h.activate(), b = h.photo('other');
  h.api.set({ modelState: 'ready' }); stage(h, presetDoc('independent', { exposure: 23 }, { smooth: 10 }), 'all');
  const running = h.api.applyNamedPreset(); await until(() => h.calls.decoded.length === 1);
  b.review.redo.push(realm(h, current(1, 'pick', 'yellow'))); pending.resolve(authoredMesh()); await running;
  assert.equal(a.settings.exposure, 0); assert.equal(b.settings.exposure, 0); assert.equal(a.undo.length, 0); assert.equal(b.undo.length, 0);
  assert.equal(a.revision, 0); assert.equal(b.revision, 0); assert.match(h.get('toast').textContent, /未应用任何照片/);
});

test('independent review UI: filtered-out current edit and IME composition cannot silently change selection or auto-advance', async () => {
  const { ready, edit, setReview, key } = uiInfrastructure(); const h = await ready();
  const a = h.activate(), b = h.photo('visible'); setReview(h, b, { rating: 5 }); h.api.setReviewView({ minRating: 5 });
  const canvas = h.api.get().source; const before = JSON.stringify(a.review);
  for (const k of ['5', 'p', 'ArrowRight']) assert.equal(key(h, k, { isComposing: true }), false);
  assert.equal(JSON.stringify(a.review), before); assert.equal(h.api.get().currentId, a.id);
  h.get('reviewScope').value = 'selected'; edit(h, { label: 'purple' }, 'current');
  assert.equal(a.review.current.label, 'purple'); assert.equal(b.review.current.label, 'none');
  assert.equal(h.api.get().source, canvas); assert.equal(h.api.get().currentId, a.id); assert.equal(a.selected, true); assert.equal(b.selected, true);
  assert.equal(h.calls.scopeConfirm.length, 0); assert.equal(h.api.queryPhotoReview().counts.hiddenSelected, 1);
});

test('independent review UI: selective late-decode navigation remains latest-wins with the real review core enabled', async () => {
  const { ready, defer } = uiInfrastructure(); const h = await ready(), a = h.activate(h.photo('first')), b = h.photo('last');
  const first = defer(), last = defer(); h.pipeline.decodeImage = blob => blob === a.blob ? first.promise : last.promise;
  h.api.set({ source: null }); const one = h.api.activatePhoto(a.id), two = h.api.activatePhoto(b.id);
  const latestCanvas = h.canvas(100, 80); last.resolve({ canvas: latestCanvas, originalWidth: 100, originalHeight: 80 }); await two;
  first.resolve({ canvas: h.canvas(100, 80), originalWidth: 100, originalHeight: 80 }); await one;
  assert.equal(h.api.get().currentId, b.id); assert.equal(h.api.get().source, latestCanvas); assert.equal(h.api.get().loadingPhoto, false);
});

for (const invalid of ['extra undefined', 'symbol', 'custom prototype', 'history array prototype', 'serialization hook', 'snapshot accessor']) {
  test(`independent review UI: missing-core neutral compatibility rejects ${invalid} rather than trusting JSON equality`, async () => {
    const { ready } = uiInfrastructure(); const h = await ready({ reviewCore: false }), p = h.activate(); let hooks = 0;
    if (invalid === 'extra undefined') p.review.extra = undefined;
    if (invalid === 'symbol') p.review[Symbol('hidden review payload')] = 1;
    if (invalid === 'custom prototype') Object.setPrototypeOf(p.review, { extra: 1 });
    if (invalid === 'history array prototype') Object.setPrototypeOf(p.review.undo, null);
    if (invalid === 'serialization hook') p.review.toJSON = () => { hooks++; return h.api.reviewDefaults(); };
    if (invalid === 'snapshot accessor') Object.defineProperty(p.review.current, 'rating', { enumerable: true, get() { hooks++; return 0; } });
    assert.throws(() => h.api.batchScopeCounts([p]), /不可用|review|neutral|无效/i);
    assert.equal(hooks, 0, 'neutral compatibility must not invoke user serialization hooks');
    assert.equal(h.calls.writes.length, 0); assert.equal(p.revision, 0);
  });
}
