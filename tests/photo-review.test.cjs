'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Review = require('../src/photo-review.cjs');
const source = fs.readFileSync(path.join(__dirname, '../src/photo-review.cjs'), 'utf8');
const flags = ['none', 'pick', 'reject'];
const labels = ['none', 'red', 'yellow', 'green', 'blue', 'purple'];
const plain = value => JSON.parse(JSON.stringify(value));
const snapshot = (rating = 0, flag = 'none', label = 'none') => ({ rating, flag, label });
const populated = () => ({ version: 1, current: snapshot(3, 'pick', 'green'), undo: [snapshot(), snapshot(1)], redo: [snapshot(5, 'reject', 'red')] });
const record = (id, name = id + '.jpg', rating = 0, flag = 'none', label = 'none', selected = false) => ({ id, name, review: { version: 1, current: snapshot(rating, flag, label), undo: [], redo: [] }, selected });
const view = changes => Object.assign(Review.viewDefaults(), changes);
function freeze(value) {
  if (value && typeof value === 'object') { for (const key of Object.keys(value)) freeze(value[key]); Object.freeze(value); }
  return value;
}
function nullObjects(value) {
  if (Array.isArray(value)) return value.map(nullObjects);
  if (!value || typeof value !== 'object') return value;
  const out = Object.create(null);
  for (const key of Object.keys(value)) out[key] = nullObjects(value[key]);
  return out;
}
function at(value, steps) { for (const step of steps) value = value[step]; return value; }
function rejectsAllState(value) {
  for (const method of ['validate', 'undo', 'redo']) assert.throws(() => Review[method](value), TypeError, method);
  assert.throws(() => Review.edit(value, { rating: 1 }), TypeError);
  assert.throws(() => Review.query([{ id: 'photo1', name: 'one.jpg', review: value, selected: false }], Review.viewDefaults()), TypeError);
}

// Public contract and independent runtime parity.
test('byte-identical browser/CommonJS modules and exact frozen API', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '../src/photo-review.js'), 'utf8'), source);
  assert.deepEqual(Object.keys(Review), ['defaults', 'validate', 'edit', 'undo', 'redo', 'viewDefaults', 'validateView', 'query']);
  assert.ok(Object.isFrozen(Review));
  assert.equal(globalThis.MintPhotoReview, Review);
  const context = vm.createContext({});
  vm.runInContext(source, context);
  assert.equal(vm.runInContext('typeof MintPhotoReview.query', context), 'function');
  const expression = `JSON.stringify(MintPhotoReview.redo(MintPhotoReview.undo(MintPhotoReview.edit(MintPhotoReview.defaults(), {rating:5,flag:'pick',label:'purple'}))))`;
  assert.equal(vm.runInContext(expression, context), JSON.stringify(Review.edit(Review.defaults(), { rating: 5, flag: 'pick', label: 'purple' })));
  const queryExpression = `JSON.stringify(MintPhotoReview.query([{id:'p2',name:'2.jpg',review:MintPhotoReview.defaults(),selected:true},{id:'p10',name:'10.jpg',review:MintPhotoReview.defaults(),selected:false}],{...MintPhotoReview.viewDefaults(),sort:'name'}))`;
  assert.equal(vm.runInContext(queryExpression, context), JSON.stringify(Review.query([record('p2', '2.jpg', 0, 'none', 'none', true), record('p10', '10.jpg')], view({ sort: 'name' }))));
});

test('defaults are exact, independently owned and neutral', () => {
  assert.deepEqual(Review.defaults(), { version: 1, current: snapshot(), undo: [], redo: [] });
  assert.deepEqual(Review.viewDefaults(), { version: 1, minRating: 0, maxRating: 5, flag: 'all', label: 'all', hideRejected: false, sort: 'import' });
  const a = Review.defaults(), b = Review.defaults();
  assert.notEqual(a, b); assert.notEqual(a.current, b.current); assert.notEqual(a.undo, b.undo); assert.notEqual(a.redo, b.redo);
  a.current.rating = 5; a.undo.push(snapshot(1));
  assert.deepEqual(b, { version: 1, current: snapshot(), undo: [], redo: [] });
  const va = Review.viewDefaults(); va.sort = 'name'; assert.equal(Review.viewDefaults().sort, 'import');
});

test('validate returns canonical fresh owned data, accepts frozen/null records and normalizes negative zero', () => {
  for (const input of [populated(), freeze(populated()), nullObjects(populated())]) {
    const out = Review.validate(input);
    assert.deepEqual(out, populated()); assert.notEqual(out, input); assert.notEqual(out.current, input.current); assert.notEqual(out.undo, input.undo); assert.notEqual(out.redo, input.redo);
    for (let i = 0; i < out.undo.length; i++) assert.notEqual(out.undo[i], input.undo[i]);
    assert.notEqual(out.redo[0], input.redo[0]);
  }
  const input = Review.defaults(); input.current.rating = -0;
  assert.ok(Object.is(Review.validate(input).current.rating, 0)); assert.ok(Object.is(input.current.rating, -0));
  const shared = snapshot(2); const aliased = { version: 1, current: shared, undo: [shared, shared], redo: [shared] };
  const result = Review.validate(aliased); result.undo[0].rating = 4;
  assert.equal(result.undo[1].rating, 2); assert.equal(result.redo[0].rating, 2); assert.equal(result.current.rating, 2); assert.equal(shared.rating, 2);
});

test('all rating, flag and color-label values work as independent and combined edits', () => {
  for (let rating = 0; rating <= 5; rating++) for (const flag of flags) for (const label of labels) {
    const changes = { rating, flag, label }, out = Review.edit(Review.defaults(), changes);
    assert.deepEqual(out.current, changes);
    assert.equal(out.undo.length, rating === 0 && flag === 'none' && label === 'none' ? 0 : 1);
    assert.deepEqual(Review.validate(out), out);
  }
  for (const changes of [{ rating: 2 }, { flag: 'reject' }, { label: 'blue' }, { rating: 4, label: 'red' }]) {
    assert.deepEqual(Review.edit(Review.defaults(), freeze(changes)).current, Object.assign(snapshot(), changes));
  }
});

test('one multi-field edit is one undo step and never mutates state or patch', () => {
  const input = freeze(populated()), changes = freeze({ rating: 4, flag: 'reject', label: 'blue' });
  const out = Review.edit(input, changes);
  assert.deepEqual(out.current, changes); assert.deepEqual(out.undo, [...input.undo, input.current]); assert.deepEqual(out.redo, []);
  assert.deepEqual(Review.undo(out).current, input.current);
  assert.deepEqual(input, populated());
  out.undo[0].rating = 4; out.current.label = 'red';
  assert.equal(input.undo[0].rating, 0); assert.equal(changes.label, 'blue');
});

test('no-op edits and unavailable undo/redo preserve histories but still return owned copies', () => {
  const input = populated();
  for (const changes of [{ rating: 3 }, { flag: 'pick', label: 'green' }, input.current]) {
    const out = Review.edit(input, changes);
    assert.deepEqual(out, input); assert.notEqual(out, input); assert.notEqual(out.current, input.current); assert.notEqual(out.undo[0], input.undo[0]); assert.notEqual(out.redo[0], input.redo[0]);
  }
  const empty = Review.defaults();
  for (const method of ['undo', 'redo']) { const out = Review[method](empty); assert.deepEqual(out, empty); assert.notEqual(out, empty); assert.notEqual(out.current, empty.current); }
  const onlyRedo = { version: 1, current: snapshot(), undo: [], redo: [snapshot(5)] };
  assert.deepEqual(Review.undo(onlyRedo), onlyRedo);
  const onlyUndo = { version: 1, current: snapshot(), undo: [snapshot(5)], redo: [] };
  assert.deepEqual(Review.redo(onlyUndo), onlyUndo);
});

test('undo/redo are exact last-in-first-out metadata snapshots', () => {
  const start = Review.defaults();
  const first = Review.edit(start, { rating: 3 });
  const second = Review.edit(first, { flag: 'pick', label: 'green' });
  const back = Review.undo(second);
  assert.deepEqual(back.current, first.current); assert.deepEqual(back.undo, [start.current]); assert.deepEqual(back.redo, [second.current]);
  assert.deepEqual(Review.redo(back), second);
  const zero = Review.undo(back);
  assert.deepEqual(zero.current, start.current); assert.deepEqual(zero.undo, []); assert.deepEqual(zero.redo, [second.current, first.current]);
  assert.deepEqual(Review.redo(Review.redo(zero)), second);
  const branched = Review.edit(back, { rating: 5 });
  assert.deepEqual(branched.redo, []); assert.deepEqual(Review.redo(branched), branched);
});

test('history caps retain newest 40 and every retained edit can be undone/redone', () => {
  let state = Review.defaults();
  for (let i = 1; i <= 55; i++) state = Review.edit(state, { rating: i % 6 });
  assert.equal(state.undo.length, 40); assert.deepEqual(state.undo[0], snapshot(15 % 6));
  const final = plain(state);
  for (let i = 54; i >= 15; i--) { state = Review.undo(state); assert.equal(state.current.rating, i % 6); }
  assert.equal(state.undo.length, 0); assert.equal(state.redo.length, 40);
  assert.deepEqual(Review.undo(state), state);
  for (let i = 16; i <= 55; i++) { state = Review.redo(state); assert.equal(state.current.rating, i % 6); }
  assert.deepEqual(state, final);
});

test('both independently saturated stacks evict oldest on destination append', () => {
  const input = { version: 1, current: snapshot(5), undo: Array.from({ length: 40 }, (_, i) => snapshot(i % 6)), redo: Array.from({ length: 40 }, (_, i) => snapshot((i + 1) % 6)) };
  const back = Review.undo(input), forward = Review.redo(input);
  assert.equal(back.undo.length, 39); assert.equal(back.redo.length, 40); assert.deepEqual(back.redo, [...input.redo.slice(1), input.current]);
  assert.equal(forward.redo.length, 39); assert.equal(forward.undo.length, 40); assert.deepEqual(forward.undo, [...input.undo.slice(1), input.current]);
});

// Strict, side-effect-free data boundary.
test('state and snapshots require every own field, at every nesting path', () => {
  for (const steps of [[], ['current'], ['undo', 0], ['redo', 0]]) {
    const fixture = populated();
    for (const key of Object.keys(at(fixture, steps))) {
      const input = populated(); delete at(input, steps)[key]; rejectsAllState(input);
    }
  }
});

test('malformed rating/version/flag/label scalars are rejected without coercion', () => {
  let reads = 0;
  const coercible = { valueOf() { reads++; return 1; }, toString() { reads++; return 'pick'; } };
  for (const bad of [-1, 6, 0.1, NaN, Infinity, -Infinity, '1', null, true, undefined, 1n, new Number(1), coercible]) {
    const input = populated(); input.current.rating = bad; rejectsAllState(input); assert.throws(() => Review.edit(Review.defaults(), { rating: bad }), TypeError);
  }
  for (const bad of [0, 2, 1.1, '1', null, true, undefined, NaN, Infinity, coercible]) { const input = populated(); input.version = bad; rejectsAllState(input); }
  for (const [key, invalid] of [['flag', ['all', 'PICK', '', false, 0, null, {}, ['pick'], coercible]], ['label', ['all', 'orange', 'RED', '', false, 0, null, {}, ['red'], coercible]]]) {
    for (const bad of invalid) { const input = populated(); input.current[key] = bad; rejectsAllState(input); assert.throws(() => Review.edit(Review.defaults(), { [key]: bad }), TypeError); }
  }
  assert.equal(reads, 0);
});

test('patch requires a nonempty own-data key subset; unknown input is never propagated', () => {
  for (const bad of [{}, [], null, undefined, 'rating', 1, { version: 1 }, { rating: 3, future: 4 }, { current: snapshot() }, { rating: 2, selected: true }]) assert.throws(() => Review.edit(Review.defaults(), bad), TypeError);
  const nullPatch = Object.assign(Object.create(null), { rating: 4 });
  assert.equal(Review.edit(Review.defaults(), nullPatch).current.rating, 4);
  for (const steps of [[], ['current'], ['undo', 0], ['redo', 0]]) for (const field of ['future', 'photo', 'path', 'source', 'settings', 'selected', 'mask', 'pixels', 'constructor', '__proto__']) {
    const input = populated(); Object.defineProperty(at(input, steps), field, { value: 1, enumerable: true }); rejectsAllState(input);
  }
});

test('every accessor at state/patch/view/query boundary is rejected with zero getter reads', () => {
  let reads = 0;
  const getter = { enumerable: true, configurable: true, get() { reads++; throw new Error('getter ran'); } };
  for (const steps of [[], ['current'], ['undo', 0], ['redo', 0]]) for (const key of Object.keys(at(populated(), steps))) {
    const input = populated(); Object.defineProperty(at(input, steps), key, getter); rejectsAllState(input);
  }
  for (const key of ['rating', 'flag', 'label']) { const changes = {}; Object.defineProperty(changes, key, getter); assert.throws(() => Review.edit(Review.defaults(), changes), TypeError); }
  for (const key of Object.keys(Review.viewDefaults())) { const input = Review.viewDefaults(); Object.defineProperty(input, key, getter); assert.throws(() => Review.validateView(input), TypeError); assert.throws(() => Review.query([], input), TypeError); }
  for (const key of Object.keys(record('p1'))) { const input = record('p1'); Object.defineProperty(input, key, getter); assert.throws(() => Review.query([input], Review.viewDefaults()), TypeError); }
  for (const stack of ['undo', 'redo']) { const input = populated(); Object.defineProperty(input[stack], '0', getter); rejectsAllState(input); }
  const records = [record('p1')]; Object.defineProperty(records, '0', getter); assert.throws(() => Review.query(records, Review.viewDefaults()), TypeError);
  assert.equal(reads, 0);
});

test('inherited missing fields and prototype accessors are never read', () => {
  const context = vm.createContext({}); vm.runInContext(source, context);
  const result = vm.runInContext(`(() => {
    let reads=0,rejected=0;
    const getter={configurable:true,get(){reads++;throw new Error('inherited read');},set(){reads++;throw new Error('inherited write');}};
    const absent = MintPhotoReview.defaults(); delete absent.current.rating;
    Object.defineProperty(Object.prototype,'rating',getter);
    Object.defineProperty(Object.prototype,'future',getter);
    Object.defineProperty(Object.prototype,'get',getter);
    Object.defineProperty(Object.prototype,'set',getter);
    try {
      try { MintPhotoReview.validate(absent); } catch(error) { if(error instanceof TypeError)rejected++;else throw error; }
      const a=MintPhotoReview.edit(MintPhotoReview.defaults(),{flag:'pick'});
      const b=MintPhotoReview.undo(a);
      const c=MintPhotoReview.query([{id:'p',name:'p.jpg',review:a,selected:true}],MintPhotoReview.viewDefaults());
      return {reads,rejected,rating:b.current.rating,selected:c.counts.selected};
    } finally {for(const key of ['rating','future','get','set'])delete Object.prototype[key];}
  })()`, context);
  assert.deepEqual(plain(result), { reads: 0, rejected: 1, rating: 0, selected: 1 });
});

test('symbols, hidden fields and custom prototypes are rejected at every record boundary', () => {
  const cases = [
    { make: populated, paths: [[], ['current'], ['undo', 0], ['redo', 0]], run: rejectsAllState },
    { make: () => ({ rating: 3 }), paths: [[]], run: v => assert.throws(() => Review.edit(Review.defaults(), v), TypeError) },
    { make: Review.viewDefaults, paths: [[]], run: v => assert.throws(() => Review.validateView(v), TypeError) },
    { make: () => record('p1'), paths: [[]], run: v => assert.throws(() => Review.query([v], Review.viewDefaults()), TypeError) }
  ];
  for (const c of cases) for (const steps of c.paths) {
    for (const mode of ['symbol', 'hiddenExtra', 'hiddenKnown', 'prototype', 'arrayPrototype', 'inherited']) {
      const value = c.make(), target = at(value, steps), first = Object.keys(target)[0];
      if (mode === 'symbol') target[Symbol('extra')] = 1;
      if (mode === 'hiddenExtra') Object.defineProperty(target, 'extra', { value: 1 });
      if (mode === 'hiddenKnown') Object.defineProperty(target, first, { enumerable: false });
      if (mode === 'prototype') Object.setPrototypeOf(target, { trusted: true });
      if (mode === 'arrayPrototype') Object.setPrototypeOf(target, Array.prototype);
      if (mode === 'inherited') { const inherited = { [first]: target[first] }; delete target[first]; Object.setPrototypeOf(target, inherited); }
      c.run(value);
    }
  }
});

test('history and records reject holes, hidden indices, extras, symbols, subclasses and over-limit sizes', () => {
  const malformed = [
    values => { delete values[0]; },
    values => { delete values[0]; values.extra = 1; },
    values => { Object.defineProperty(values, '0', { enumerable: false }); },
    values => { values.extra = 1; },
    values => { values[Symbol('extra')] = 1; },
    values => { Object.defineProperty(values, 'extra', { value: 1 }); },
    values => { Object.setPrototypeOf(values, null); },
    values => { Object.setPrototypeOf(values, Object.create(Array.prototype)); }
  ];
  for (const mutate of malformed) {
    for (const stack of ['undo', 'redo']) { const input = populated(); mutate(input[stack]); rejectsAllState(input); }
    const input = [record('p1')]; mutate(input); assert.throws(() => Review.query(input, Review.viewDefaults()), TypeError);
  }
  for (const stack of ['undo', 'redo']) {
    for (const bad of [Array.from({ length: 41 }, () => snapshot()), new Array(4294967295), {}, null, '[]', new Uint8Array(1)]) { const input = populated(); input[stack] = bad; rejectsAllState(input); }
  }
  for (const bad of [Array.from({ length: 101 }, (_, i) => record('p' + i)), new Array(4294967295), {}, null, '[]', new Uint8Array(1)]) assert.throws(() => Review.query(bad, Review.viewDefaults()), TypeError);
});

test('malformed historical snapshots fail even when current is valid and query filters them out', () => {
  for (const stack of ['undo', 'redo']) {
    const input = populated(); input[stack][0].rating = 99; rejectsAllState(input);
    const r = record('p1'); r.review = input;
    assert.throws(() => Review.query([r], view({ minRating: 5 })), TypeError);
  }
});

// View validation, query visibility and explicit retained selection.
test('view requires exact fields, safe scalars, valid bounds and strict enumerations', () => {
  for (const key of Object.keys(Review.viewDefaults())) { const input = Review.viewDefaults(); delete input[key]; assert.throws(() => Review.validateView(input), TypeError); }
  for (const key of ['minRating', 'maxRating']) for (const bad of [-1, 6, .5, NaN, Infinity, '2', true, null, {}, 1n]) assert.throws(() => Review.validateView(view({ [key]: bad })), TypeError);
  for (const bad of [0, 2, '1', null, true]) assert.throws(() => Review.validateView(view({ version: bad })), TypeError);
  assert.throws(() => Review.validateView(view({ minRating: 4, maxRating: 3 })), TypeError);
  for (const bad of [undefined, 0, 1, 'false', null, {}]) assert.throws(() => Review.validateView(view({ hideRejected: bad })), TypeError);
  for (const bad of ['rating', 'desc', 'NAME', '', null, {}]) assert.throws(() => Review.validateView(view({ sort: bad })), TypeError);
  for (const bad of ['picked', 'ALL', '', null, true, {}]) assert.throws(() => Review.validateView(view({ flag: bad })), TypeError);
  for (const bad of ['orange', 'ALL', '', null, true, {}]) assert.throws(() => Review.validateView(view({ label: bad })), TypeError);
  assert.throws(() => Review.validateView(view({ extra: true })), TypeError);
  for (const flag of ['all', ...flags]) for (const label of ['all', ...labels]) for (const sort of ['import', 'name', 'rating-desc', 'rating-asc']) {
    const input = freeze(view({ flag, label, sort })), out = Review.validateView(input);
    assert.deepEqual(out, input); assert.notEqual(out, input);
  }
  assert.deepEqual(Review.validateView(nullObjects(Review.viewDefaults())), Review.viewDefaults());
  assert.ok(Object.is(Review.validateView(view({ minRating: -0, maxRating: -0 })).minRating, 0));
});

test('empty query has exact neutral results and independent output arrays', () => {
  const result = Review.query([], Review.viewDefaults());
  assert.deepEqual(result, { orderedIds: [], visibleIds: [], selectedIds: [], visibleSelectedIds: [], hiddenSelectedIds: [], rejectedSelectedIds: [], counts: { total: 0, visible: 0, hidden: 0, selected: 0, visibleSelected: 0, hiddenSelected: 0, rejected: 0, rejectedSelected: 0 } });
  result.orderedIds.push('x'); assert.deepEqual(result.visibleIds, []);
});

test('neutral view preserves import order, every photo and every selection exactly', () => {
  const input = freeze([record('p3', '3.jpg', 3, 'pick', 'green', true), record('p1', '1.jpg', 5, 'reject', 'red', true), record('p2', '2.jpg', 0)]);
  assert.deepEqual(Review.query(input, freeze(Review.viewDefaults())), {
    orderedIds: ['p3', 'p1', 'p2'], visibleIds: ['p3', 'p1', 'p2'], selectedIds: ['p3', 'p1'], visibleSelectedIds: ['p3', 'p1'], hiddenSelectedIds: [], rejectedSelectedIds: ['p1'],
    counts: { total: 3, visible: 3, hidden: 0, selected: 2, visibleSelected: 2, hiddenSelected: 0, rejected: 1, rejectedSelected: 1 }
  });
});

test('hidden and rejected selected photos remain explicit, never silently deselected', () => {
  const records = freeze([
    record('a', '4.jpg', 5, 'pick', 'red', true),
    record('b', '3.jpg', 4, 'reject', 'red', true),
    record('c', '2.jpg', 1, 'none', 'blue', true),
    record('d', '1.jpg', 4, 'pick', 'red', false)
  ]);
  const result = Review.query(records, view({ minRating: 3, label: 'red', hideRejected: true, sort: 'name' }));
  assert.deepEqual(result.orderedIds, ['d', 'c', 'b', 'a']); assert.deepEqual(result.visibleIds, ['d', 'a']);
  assert.deepEqual(result.selectedIds, ['c', 'b', 'a']); assert.deepEqual(result.visibleSelectedIds, ['a']); assert.deepEqual(result.hiddenSelectedIds, ['c', 'b']); assert.deepEqual(result.rejectedSelectedIds, ['b']);
  assert.deepEqual(result.counts, { total: 4, visible: 2, hidden: 2, selected: 3, visibleSelected: 1, hiddenSelected: 2, rejected: 1, rejectedSelected: 1 });
  assert.deepEqual(records.map(r => r.selected), [true, true, true, false]);
  const impossible = Review.query(records, view({ flag: 'reject', hideRejected: true }));
  assert.deepEqual(impossible.visibleIds, []); assert.deepEqual(impossible.hiddenSelectedIds, ['a', 'b', 'c']); assert.deepEqual(impossible.selectedIds, ['a', 'b', 'c']);
});

test('all inclusive rating bounds, flags, labels and conjunctions match reference predicates', () => {
  const records = [];
  for (let rating = 0; rating <= 5; rating++) for (const flag of flags) for (const label of ['none', 'red', 'purple']) records.push(record('p' + records.length, 'photo.jpg', rating, flag, label, records.length % 2 === 0));
  for (let low = 0; low <= 5; low++) for (let high = low; high <= 5; high++) for (const flag of ['all', ...flags]) for (const label of ['all', 'none', 'red', 'purple']) for (const hideRejected of [false, true]) {
    const config = view({ minRating: low, maxRating: high, flag, label, hideRejected });
    const actual = Review.query(records, config);
    const expected = records.filter(r => r.review.current.rating >= low && r.review.current.rating <= high && (flag === 'all' || r.review.current.flag === flag) && (label === 'all' || r.review.current.label === label) && (!hideRejected || r.review.current.flag !== 'reject')).map(r => r.id);
    assert.deepEqual(actual.visibleIds, expected);
    assert.equal(actual.counts.visible + actual.counts.hidden, records.length);
    assert.equal(actual.counts.visibleSelected + actual.counts.hiddenSelected, actual.counts.selected);
  }
});

test('100 records and maximum 40+40 histories validate with exact complete counts', () => {
  const records = Array.from({ length: 100 }, (_, i) => {
    const item = record('p' + i, 'photo' + (100 - i) + '.jpg', i % 6, i % 4 === 0 ? 'reject' : 'pick', labels[i % labels.length], true);
    item.review.undo = Array.from({ length: 40 }, (_, j) => snapshot(j % 6)); item.review.redo = Array.from({ length: 40 }, (_, j) => snapshot((j + 1) % 6));
    return item;
  });
  const before = JSON.stringify(records);
  const result = Review.query(freeze(records), view({ hideRejected: true, sort: 'name' }));
  assert.equal(result.orderedIds.length, 100); assert.equal(new Set(result.orderedIds).size, 100);
  assert.equal(result.orderedIds[0], 'p99'); assert.equal(result.orderedIds[99], 'p0');
  assert.deepEqual(result.counts, { total: 100, visible: 75, hidden: 25, selected: 100, visibleSelected: 75, hiddenSelected: 25, rejected: 25, rejectedSelected: 25 });
  assert.equal(JSON.stringify(records), before);
});

test('rating sorting is stable by import position, not name/ID, for every output list', () => {
  const input = [record('z', 'z.jpg', 2, 'none', 'none', true), record('a', 'a.jpg', 5, 'reject', 'none', true), record('b', 'b.jpg', 2, 'reject', 'none', true), record('c', 'c.jpg', 5, 'none', 'none', true), record('d', 'd.jpg', 0)];
  const desc = Review.query(input, view({ sort: 'rating-desc', hideRejected: true }));
  assert.deepEqual(desc.orderedIds, ['a', 'c', 'z', 'b', 'd']); assert.deepEqual(desc.visibleIds, ['c', 'z', 'd']); assert.deepEqual(desc.selectedIds, ['a', 'c', 'z', 'b']); assert.deepEqual(desc.hiddenSelectedIds, ['a', 'b']); assert.deepEqual(desc.rejectedSelectedIds, ['a', 'b']);
  assert.deepEqual(Review.query(input, view({ sort: 'rating-asc' })).orderedIds, ['d', 'z', 'b', 'a', 'c']);
  assert.deepEqual(input.map(r => r.id), ['z', 'a', 'b', 'c', 'd']);
});

test('natural-name sorting compares arbitrary-length digit runs, Unicode units and multiple runs deterministically', () => {
  const names = ['IMG10.jpg', 'IMG002.jpg', 'IMG2.jpg', 'IMG01.jpg', 'IMG1.jpg', 'img1.jpg', '中2.jpg', '中10.jpg', 'IMG999999999999999999999999999999.jpg', 'IMG1000000000000000000000000000000.jpg', 'IMG2a10.jpg', 'IMG2a2.jpg', 'IMG0.jpg', 'IMG00.jpg'];
  const records = names.map((name, i) => record('p' + i, name));
  assert.deepEqual(Review.query(records, view({ sort: 'name' })).orderedIds, ['p12', 'p13', 'p3', 'p4', 'p1', 'p2', 'p11', 'p10', 'p0', 'p8', 'p9', 'p5', 'p6', 'p7']);
  const same = [record('z', 'same.jpg'), record('a', 'same.jpg'), record('m', 'same.jpg')];
  assert.deepEqual(Review.query(same, view({ sort: 'name' })).orderedIds, ['z', 'a', 'm']);
  const long = [record('a', 'x' + '0'.repeat(400) + '2.jpg'), record('b', 'x2.jpg'), record('c', 'x10.jpg')];
  assert.deepEqual(Review.query(long, view({ sort: 'name' })).orderedIds, ['a', 'b', 'c']);
});

test('record IDs are unique strict project identifiers and records have exact required fields', () => {
  for (const bad of ['', 'a'.repeat(161), 'a b', '../photo', 'x/y', 'x\\y', 'x\n', '_x', '-x', '中', '__proto__', 'constructor', 'prototype', 1, null, {}, new String('p1')]) assert.throws(() => Review.query([record(bad, 'safe.jpg')], Review.viewDefaults()), TypeError);
  for (const good of ['p', 'A-Z_0.1:2', 'a'.repeat(160), 'toString', 'hasOwnProperty']) assert.equal(Review.query([record(good, 'ok.jpg')], Review.viewDefaults()).orderedIds[0], good);
  assert.throws(() => Review.query([record('p'), record('p')], Review.viewDefaults()), /Duplicate/);
  for (const key of ['id', 'name', 'review', 'selected']) { const input = record('p'); delete input[key]; assert.throws(() => Review.query([input], Review.viewDefaults()), TypeError); }
  for (const bad of [null, 0, 1, 'true', undefined, {}]) { const input = record('p'); input.selected = bad; assert.throws(() => Review.query([input], Review.viewDefaults()), TypeError); }
  const extra = record('p'); extra.settings = { exposure: 4 }; assert.throws(() => Review.query([extra], Review.viewDefaults()), TypeError);
  const output = Review.query([record('p')], Review.viewDefaults());
  assert.deepEqual(Object.keys(output), ['orderedIds', 'visibleIds', 'selectedIds', 'visibleSelectedIds', 'hiddenSelectedIds', 'rejectedSelectedIds', 'counts']);
  assert.equal(JSON.stringify(output).includes('name'), false); assert.equal(JSON.stringify(output).includes('review'), false);
});

test('filenames match project compatibility without trimming, HTML transformation or normalization', () => {
  for (const good of ['a', 'x'.repeat(512), '  photo 02.jpg  ', '肖像🌸 2.jpg', 'é.jpg', 'e\u0301.jpg', '<img src=x onerror=alert(1)>.jpg', 'a\u0085b.jpg', '\ud800.jpg']) {
    const input = record('p', good); const before = input.name;
    assert.deepEqual(Review.query([input], view({ sort: 'name' })).orderedIds, ['p']); assert.equal(input.name, before);
  }
  for (const bad of ['', 'x'.repeat(513), 'bad\0.jpg', 'bad\n.jpg', 'bad\t.jpg', 'bad\u007f.jpg', 1, null, undefined, {}, new String('p.jpg')]) { const item = record('p'); item.name = bad; assert.throws(() => Review.query([item], Review.viewDefaults()), TypeError); }
});

test('query output cannot alias or modify records, view, review histories or sibling arrays', () => {
  const records = [record('p2', '2.jpg', 2, 'none', 'blue', true), record('p1', '1.jpg', 5, 'reject', 'red', true)];
  records[0].review = populated(); const config = view({ sort: 'name' }), before = plain({ records, config });
  const out = Review.query(records, config);
  out.orderedIds[0] = 'changed'; out.visibleIds.push('invented'); out.selectedIds.length = 0; out.counts.total = 999;
  assert.deepEqual({ records, config }, before);
  assert.deepEqual(out.visibleSelectedIds, ['p1', 'p2']);
  assert.deepEqual(Review.query(records, config).orderedIds, ['p1', 'p2']);
});

test('bounded deterministic randomized edit/history model stays equivalent', () => {
  let seed = 73421;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  let state = Review.defaults(), model = Review.defaults();
  for (let i = 0; i < 2000; i++) {
    const action = random(5), prior = plain(state);
    if (action <= 2) {
      const changes = action === 0 ? { rating: random(6) } : action === 1 ? { flag: flags[random(3)] } : { label: labels[random(6)] };
      const next = Object.assign({}, model.current, changes);
      state = Review.edit(freeze(state), freeze(changes));
      if (JSON.stringify(next) !== JSON.stringify(model.current)) model = { version: 1, current: next, undo: [...model.undo, model.current].slice(-40), redo: [] };
    } else if (action === 3) {
      state = Review.undo(freeze(state));
      if (model.undo.length) model = { version: 1, current: model.undo.at(-1), undo: model.undo.slice(0, -1), redo: [...model.redo, model.current].slice(-40) };
    } else {
      state = Review.redo(freeze(state));
      if (model.redo.length) model = { version: 1, current: model.redo.at(-1), undo: [...model.undo, model.current].slice(-40), redo: model.redo.slice(0, -1) };
    }
    assert.deepEqual(state, model, 'step ' + i); assert.deepEqual(Review.validate(state), state); assert.ok(state.undo.length <= 40 && state.redo.length <= 40);
    assert.equal(typeof prior.current.rating, 'number');
  }
});
