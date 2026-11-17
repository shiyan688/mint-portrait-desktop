/* Mint photo review v1: authored ratings, flags, labels, and view ordering only.
 * Pure bounded metadata. No pixel edits, source access, I/O, or automatic culling.
 * Keep photo-review.js and photo-review.cjs byte-identical. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module !== null && module.exports) module.exports = api;
  if (root) {
    const attributes = Object.create(null);
    attributes.value = api; attributes.enumerable = true; attributes.configurable = true; attributes.writable = true;
    Object.defineProperty(root, 'MintPhotoReview', attributes);
  }
})(typeof globalThis === 'object' ? globalThis : null, function () {
  'use strict';
  const MAX_HISTORY = 40, MAX_RECORDS = 100;
  const FLAGS = Object.freeze(['none', 'pick', 'reject']);
  const LABELS = Object.freeze(['none', 'red', 'yellow', 'green', 'blue', 'purple']);
  const SORTS = Object.freeze(['import', 'name', 'rating-desc', 'rating-asc']);
  const CURRENT_KEYS = Object.freeze(['rating', 'flag', 'label']);
  const STATE_KEYS = Object.freeze(['version', 'current', 'undo', 'redo']);
  const VIEW_KEYS = Object.freeze(['version', 'minRating', 'maxRating', 'flag', 'label', 'hideRejected', 'sort']);
  const RECORD_KEYS = Object.freeze(['id', 'name', 'review', 'selected']);
  const own = Object.hasOwn, descriptor = Object.getOwnPropertyDescriptor;
  const define = Object.defineProperty, keys = Reflect.ownKeys, proto = Object.getPrototypeOf;
  const create = Object.create, isArray = Array.isArray;
  const objectPrototype = Object.prototype, arrayPrototype = Array.prototype;

  function check(ok, message) { if (!ok) throw new TypeError(message); }
  function put(target, key, value) {
    const attributes = create(null);
    attributes.value = value; attributes.enumerable = true; attributes.writable = true; attributes.configurable = true;
    define(target, key, attributes);
  }
  function append(array, value) { put(array, String(array.length), value); }
  function contains(values, value) {
    for (let i = 0; i < values.length; i++) if (values[i] === value) return true;
    return false;
  }
  function data(value, key, label) {
    const d = descriptor(value, key);
    check(d !== undefined && own(d, 'value') && d.enumerable === true, 'Invalid ' + label + ' data property');
    return d.value;
  }
  // Validate every key and descriptor before returning any field values. Captures
  // use null-prototype owned records, so missing fields cannot fall through.
  function record(value, allowed, label, partial) {
    check(value !== null && typeof value === 'object' && !isArray(value), 'Invalid ' + label + ' object');
    const p = proto(value);
    check(p === objectPrototype || p === null, 'Invalid ' + label + ' prototype');
    const actual = keys(value);
    check(partial ? actual.length >= 1 && actual.length <= allowed.length : actual.length === allowed.length, 'Invalid ' + label + ' fields');
    const out = create(null);
    for (let i = 0; i < actual.length; i++) {
      const key = actual[i];
      check(typeof key === 'string' && contains(allowed, key), 'Invalid ' + label + ' field');
      put(out, key, data(value, key, label));
    }
    if (!partial) for (let i = 0; i < allowed.length; i++) check(own(out, allowed[i]), 'Missing ' + label + ' field');
    return out;
  }
  function denseArray(value, limit, label) {
    check(isArray(value) && proto(value) === arrayPrototype, 'Invalid ' + label + ' array');
    const size = descriptor(value, 'length');
    check(size !== undefined && own(size, 'value') && Number.isSafeInteger(size.value) && size.value >= 0 && size.value <= limit, 'Invalid ' + label + ' length');
    check(keys(value).length === size.value + 1, 'Invalid ' + label + ' fields');
    const out = [];
    for (let i = 0; i < size.value; i++) append(out, data(value, String(i), label));
    return out;
  }
  function rating(value, label) {
    check(typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5, 'Invalid ' + label);
    return value === 0 ? 0 : value;
  }
  function enumeration(value, values, label) { check(contains(values, value), 'Invalid ' + label); return value; }
  function boolean(value, label) { check(typeof value === 'boolean', 'Invalid ' + label); return value; }
  function snapshot(value) {
    const v = record(value, CURRENT_KEYS, 'review snapshot', false);
    return { rating: rating(v.rating, 'rating'), flag: enumeration(v.flag, FLAGS, 'flag'), label: enumeration(v.label, LABELS, 'label') };
  }
  function history(value, label) {
    const values = denseArray(value, MAX_HISTORY, label), out = [];
    for (let i = 0; i < values.length; i++) append(out, snapshot(values[i]));
    return out;
  }
  function defaults() { return { version: 1, current: { rating: 0, flag: 'none', label: 'none' }, undo: [], redo: [] }; }
  function validate(state) {
    const v = record(state, STATE_KEYS, 'review state', false);
    check(v.version === 1, 'Unsupported review version');
    return { version: 1, current: snapshot(v.current), undo: history(v.undo, 'undo history'), redo: history(v.redo, 'redo history') };
  }
  function patch(value) {
    const v = record(value, CURRENT_KEYS, 'review patch', true), out = create(null);
    if (own(v, 'rating')) put(out, 'rating', rating(v.rating, 'rating'));
    if (own(v, 'flag')) put(out, 'flag', enumeration(v.flag, FLAGS, 'flag'));
    if (own(v, 'label')) put(out, 'label', enumeration(v.label, LABELS, 'label'));
    return out;
  }
  function appendedHistory(values, last) {
    const out = [], start = values.length === MAX_HISTORY ? 1 : 0;
    for (let i = start; i < values.length; i++) append(out, values[i]);
    append(out, last);
    return out;
  }
  function withoutLast(values) {
    const out = [];
    for (let i = 0; i + 1 < values.length; i++) append(out, values[i]);
    return out;
  }
  function edit(state, changes) {
    const out = validate(state), clean = patch(changes);
    const next = {
      rating: own(clean, 'rating') ? clean.rating : out.current.rating,
      flag: own(clean, 'flag') ? clean.flag : out.current.flag,
      label: own(clean, 'label') ? clean.label : out.current.label
    };
    if (next.rating === out.current.rating && next.flag === out.current.flag && next.label === out.current.label) return out;
    return { version: 1, current: next, undo: appendedHistory(out.undo, out.current), redo: [] };
  }
  function undo(state) {
    const out = validate(state);
    if (out.undo.length === 0) return out;
    return { version: 1, current: out.undo[out.undo.length - 1], undo: withoutLast(out.undo), redo: appendedHistory(out.redo, out.current) };
  }
  function redo(state) {
    const out = validate(state);
    if (out.redo.length === 0) return out;
    return { version: 1, current: out.redo[out.redo.length - 1], undo: appendedHistory(out.undo, out.current), redo: withoutLast(out.redo) };
  }
  function viewDefaults() { return { version: 1, minRating: 0, maxRating: 5, flag: 'all', label: 'all', hideRejected: false, sort: 'import' }; }
  function validateView(view) {
    const v = record(view, VIEW_KEYS, 'review view', false);
    check(v.version === 1, 'Unsupported review view version');
    const minRating = rating(v.minRating, 'minimum rating'), maxRating = rating(v.maxRating, 'maximum rating');
    check(minRating <= maxRating, 'Minimum rating exceeds maximum rating');
    check(v.flag === 'all' || contains(FLAGS, v.flag), 'Invalid view flag');
    check(v.label === 'all' || contains(LABELS, v.label), 'Invalid view label');
    return { version: 1, minRating, maxRating, flag: v.flag, label: v.label, hideRejected: boolean(v.hideRejected, 'hide rejected'), sort: enumeration(v.sort, SORTS, 'sort') };
  }
  function identifier(value) {
    check(typeof value === 'string' && value.length >= 1 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value) && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value) && value !== 'constructor' && value !== 'prototype' && value !== '__proto__', 'Invalid photo ID');
    return value;
  }
  function filename(value) {
    // Match project display-name validation exactly; preserve Unicode, spacing,
    // punctuation and literal markup. The UI must render names as text, not HTML.
    check(typeof value === 'string' && value.length >= 1 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value), 'Invalid photo name');
    return value;
  }
  function digit(code) { return code >= 48 && code <= 57; }
  // Locale-free natural ordering. Equal numeric runs ignore zero padding; no
  // Number conversion, floating-point rounding, case folding, or normalization.
  function naturalName(a, b) {
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      const ac = a.charCodeAt(i), bc = b.charCodeAt(j);
      if (digit(ac) && digit(bc)) {
        let ae = i, be = j;
        while (ae < a.length && digit(a.charCodeAt(ae))) ae++;
        while (be < b.length && digit(b.charCodeAt(be))) be++;
        let az = i, bz = j;
        while (az < ae && a.charCodeAt(az) === 48) az++;
        while (bz < be && b.charCodeAt(bz) === 48) bz++;
        if (ae - az !== be - bz) return ae - az < be - bz ? -1 : 1;
        while (az < ae) { const d = a.charCodeAt(az++) - b.charCodeAt(bz++); if (d !== 0) return d < 0 ? -1 : 1; }
        i = ae; j = be;
      } else {
        if (ac !== bc) return ac < bc ? -1 : 1;
        i++; j++;
      }
    }
    return i === a.length ? (j === b.length ? 0 : -1) : 1;
  }
  function ordered(records, sort) {
    // Bounded stable insertion sort, with no dependence on engine sort stability.
    if (sort === 'import') return records;
    for (let i = 1; i < records.length; i++) {
      const item = records[i]; let j = i;
      while (j > 0) {
        const prior = records[j - 1];
        const comparison = sort === 'name' ? naturalName(prior.name, item.name) : sort === 'rating-desc' ? item.current.rating - prior.current.rating : prior.current.rating - item.current.rating;
        if (comparison <= 0) break;
        put(records, String(j), prior); j--;
      }
      put(records, String(j), item);
    }
    return records;
  }
  function query(records, view) {
    const cleanView = validateView(view), source = denseArray(records, MAX_RECORDS, 'photo records'), clean = [], seen = create(null);
    for (let i = 0; i < source.length; i++) {
      const v = record(source[i], RECORD_KEYS, 'photo record', false), id = identifier(v.id);
      check(!own(seen, id), 'Duplicate photo ID'); put(seen, id, true);
      const name = filename(v.name), review = validate(v.review), selected = boolean(v.selected, 'photo selection');
      append(clean, { id, name, current: review.current, selected });
    }
    ordered(clean, cleanView.sort);
    const orderedIds = [], visibleIds = [], selectedIds = [], visibleSelectedIds = [], hiddenSelectedIds = [], rejectedSelectedIds = [];
    let rejected = 0;
    for (let i = 0; i < clean.length; i++) {
      const item = clean[i], c = item.current;
      const visible = c.rating >= cleanView.minRating && c.rating <= cleanView.maxRating && (cleanView.flag === 'all' || c.flag === cleanView.flag) && (cleanView.label === 'all' || c.label === cleanView.label) && (!cleanView.hideRejected || c.flag !== 'reject');
      append(orderedIds, item.id);
      if (visible) append(visibleIds, item.id);
      if (c.flag === 'reject') rejected++;
      if (item.selected) {
        append(selectedIds, item.id);
        append(visible ? visibleSelectedIds : hiddenSelectedIds, item.id);
        if (c.flag === 'reject') append(rejectedSelectedIds, item.id);
      }
    }
    return {
      orderedIds, visibleIds, selectedIds, visibleSelectedIds, hiddenSelectedIds, rejectedSelectedIds,
      counts: { total: clean.length, visible: visibleIds.length, hidden: clean.length - visibleIds.length, selected: selectedIds.length, visibleSelected: visibleSelectedIds.length, hiddenSelected: hiddenSelectedIds.length, rejected, rejectedSelected: rejectedSelectedIds.length }
    };
  }
  return Object.freeze({ defaults, validate, edit, undo, redo, viewDefaults, validateView, query });
});
