# MintPhotoReview v1 contract

## Purpose and scope

A dependency-free, synchronous, bounded metadata core for explicit user-authored photo ratings, flags, color labels, filtering and ordering. It does not read files, access sources, edit pixels, render HTML, contact a service, execute a model, score faces, or automatically cull photos.

The same UMD source is shipped as `photo-review.js` and `photo-review.cjs`; the two files must remain byte-identical. CommonJS exports and the browser global `MintPhotoReview` expose exactly the following frozen API:

```js
{ defaults, validate, edit, undo, redo, viewDefaults, validateView, query }
```

No external imports or runtime dependencies are required. All operations are pure with respect to their inputs. All returned data is independently owned, mutable ordinary data with fresh arrays and records. The API object itself is frozen. Invalid inputs throw `TypeError`; there is no coercion, field stripping, partial success, silent clamp, or forward-version guessing.

## Review state

`defaults()` returns a fresh value:

```json
{
  "version": 1,
  "current": { "rating": 0, "flag": "none", "label": "none" },
  "undo": [],
  "redo": []
}
```

- `rating`: integer 0 through 5 inclusive; 0 means unrated. Numeric negative zero is accepted and canonicalized to positive zero.
- `flag`: exactly `none`, `pick`, or `reject`.
- `label`: exactly `none`, `red`, `yellow`, `green`, `blue`, or `purple`.
- `undo` and `redo`: dense arrays of current-style snapshots, each independently limited to 40 entries, oldest first and next-to-restore last. Snapshot objects contain only `rating`, `flag`, and `label`, without nested histories.
- `version`: numeric 1 only.

`validate(state)` fully checks the current snapshot and every snapshot in both histories, then returns a fresh canonical copy. Repeated references in valid input are copied independently; there are no input aliases or cross-snapshot aliases in the output. The validator does not infer or rewrite history semantics: repeated neighboring snapshots and independently full undo/redo stacks are valid data.

`edit(state, patch)` accepts a nonempty patch containing one, two, or all three of `rating`, `flag`, and `label`. Each supplied value must satisfy the same scalar rules as the current snapshot.

- If any supplied value changes, the entire previous current snapshot is appended to undo once, the new snapshot becomes current, and redo is cleared.
- A multi-field change is one history step.
- If all supplied values are unchanged, both histories are preserved exactly and no history entry is added. The returned value is still a fresh copy, including every snapshot.
- Appending to a full history drops only the oldest entry and retains the newest 40.

`undo(state)` restores the last undo snapshot and appends the previous current snapshot to redo. `redo(state)` does the inverse. Both use the same independent 40-entry destination cap. If the requested history is empty, the operation is a no-op returning a fresh canonical copy; it does not discard the other history.

## View state

`viewDefaults()` returns a fresh value:

```json
{
  "version": 1,
  "minRating": 0,
  "maxRating": 5,
  "flag": "all",
  "label": "all",
  "hideRejected": false,
  "sort": "import"
}
```

`validateView(view)` requires all seven fields and returns a fresh canonical value.

- `version`: numeric 1 only.
- `minRating` and `maxRating`: integer 0 through 5 inclusive, with minimum not exceeding maximum. Negative zero canonicalizes to zero.
- `flag`: `all` or one of the review flags.
- `label`: `all` or one of the review labels.
- `hideRejected`: boolean only.
- `sort`: exactly `import`, `name`, `rating-desc`, or `rating-asc`.

Filters are combined with AND. The rating bounds are inclusive. `none` is an exact value, not a synonym for `all`. `flag: "reject"` together with `hideRejected: true` is allowed and deliberately yields no visible photos; neither setting overrides the other.

## Query

`query(records, view)` requires both arguments. `records` is a dense array containing 0 to 100 records, each exactly:

```js
{ id, name, review, selected }
```

- `id`: project-compatible identifier, 1–160 UTF-16 units, matching `[A-Za-z0-9][A-Za-z0-9_.:-]*` over the full string. ASCII controls including DEL are forbidden. `constructor`, `prototype`, and `__proto__` are forbidden. IDs must be unique within this query.
- `name`: project-compatible display-name string, 1–512 UTF-16 units, without ASCII U+0000–U+001F or U+007F. No trimming, case folding, Unicode normalization, HTML transformation, or filesystem-path interpretation occurs. Unicode names, spaces and literal markup remain data. This intentionally matches the existing project display-name boundary, including its acceptance of U+0080–U+009F and lone UTF-16 surrogates. The UI must use text rendering, never assign names to `innerHTML`.
- `review`: a complete valid review state, including both histories. Malformed histories fail even if a photo would be filtered out.
- `selected`: boolean only. Query never changes this value or infers a new selection.

Query validates every record before returning any result. It returns exactly:

```js
{
  orderedIds,
  visibleIds,
  selectedIds,
  visibleSelectedIds,
  hiddenSelectedIds,
  rejectedSelectedIds,
  counts: {
    total, visible, hidden, selected,
    visibleSelected, hiddenSelected, rejected, rejectedSelected
  }
}
```

Every ID array is fresh, contains only IDs, and follows the chosen sort order:

- `orderedIds`: all records, regardless of visibility or selection.
- `visibleIds`: records satisfying every view filter.
- `selectedIds`: every selected record, including hidden and rejected photos.
- `visibleSelectedIds`: selected and visible.
- `hiddenSelectedIds`: selected and not visible.
- `rejectedSelectedIds`: selected and flagged reject, whether visible or hidden.

The eight count fields are respectively all records, visible records, hidden records, all selected records, visible selected, hidden selected, all rejected records, and all rejected selected records. Thus `visible + hidden === total` and `visibleSelected + hiddenSelected === selected`. `rejected` and `rejectedSelected` are independent of visibility.

The neutral view retains all photos, import order, and selections exactly. Filtering does not silently deselect hidden photos. Hiding rejected photos is not removal and is not an export exclusion policy. UI actions must explicitly choose their intended target set and show hidden/rejected selection counts before potentially surprising batch operations.

### Deterministic ordering

- `import`: the caller's original array order, unchanged.
- `rating-desc` or `rating-asc`: current rating, with all equal ratings retaining original array order. Name and ID are not secondary tie breakers.
- `name`: case-sensitive, locale-independent natural order. Consecutive ASCII digit runs compare as arbitrary-length nonnegative integers, ignoring leading zeroes. All other characters compare by exact UTF-16 code units. There is no locale comparison, Unicode normalization or floating-point conversion. Equivalent complete names retain import order, including `IMG2.jpg` versus `IMG002.jpg`. Comparisons continue after equal numeric runs, so later text or digit runs still determine order.

An explicit stable insertion sort avoids depending on runtime sort stability. Accepted input is bounded to 100 records and 512-unit names; each record has at most 80 historical snapshots plus current. No operation allocates image-sized buffers or performs pixel work.

## Strict plain-data boundary

Every accepted object has the current realm's `Object.prototype` or a null prototype. Frozen/read-only data properties are accepted. Every accepted array has the current realm's `Array.prototype` and a valid native length.

- All required fields must be present as own enumerable data properties before their captured values are consumed.
- Accessors, symbols, hidden properties, extra keys, inherited fields, custom prototypes, boxed scalars, sparse arrays and extended arrays are rejected.
- Missing fields never fall through to inherited values or getters.
- Records are captured through own descriptors, not property getters, object spread or user-supplied serialization hooks.
- All array indices must be own enumerable data properties. Arrays have no own keys except `length` and their dense indices.
- Unknown input fields are rejected rather than propagated.
- No field or scalar conversion calls user `toString`, `valueOf` or `toJSON` hooks.
- Cycles cannot satisfy the fixed nonrecursive schema.

This is a plain-data validation contract, not an execution sandbox for malicious JavaScript `Proxy` handlers or a compromised runtime. JavaScript reflection can invoke proxy traps, which cannot be reliably identified without runtime-specific facilities. Same-realm plain records (or JSON-parsed persisted data) are the supported boundary; cross-realm custom prototypes are intentionally rejected. The zero-getter-read guarantee covers ordinary property accessors, including missing inherited fields, not reflection proxy traps.

## Integration

The desktop stores per-photo state as `photo.review`, separate from pixel `settings`, `committed`, pixel-edit undo/redo and learned caches. Its project codec writes schema 6 and migrates versions 1–5 to neutral review states. The generic photo revision advances on an effective review command to invalidate pending UI snapshots; the immutable source revision does not change. Filter/sort view state is session-only, not a project field.

Construct the exact query records explicitly; do not pass whole photo objects containing sources, blobs, settings or caches. For example:

```js
const results = MintPhotoReview.query(
  photos.map(photo => ({
    id: photo.id,
    name: photo.name,
    review: photo.review,
    selected: photo.selected
  })),
  reviewView
);
```

Do not overwrite the master photo array with the visible subset or derive `selected` from visibility. A metadata-only edit does not require rerendering source pixels, changing pixel undo/redo, invalidating learned results, or modifying export bytes. Project save/dirty tracking should separately account for changed metadata.

The shared core is integrated at `src/photo-review.cjs` with a byte-identical `.js` alias. It is an ordinary metadata module, not an AI ranking model. Project schema 6 integration has local regression coverage. The desktop interface has separate integration tests and release status; these core tests alone do not establish browser or Windows acceptance.

## Verification

Run from the desktop source root without invoking a package manager:

```sh
node --test --test-reporter=tap tests/photo-review.test.cjs
cmp src/photo-review.js src/photo-review.cjs
```

The test suite covers exact UMD/CommonJS parity; defaults and fresh ownership; every rating/flag/label combination; multi-field and no-op history; undo/redo branching and saturation; mandatory own fields; zero accessor reads; inherited getter safety; hidden/symbol/extra/prototype/sparse-array rejection; strict scalars and bounds; full-history query validation; exhaustive filter combinations; all 100 photos with maximum histories; hidden/rejected selection reporting; import and rating ties; numeric, long-digit, zero-padded and Unicode names; compatible filename boundaries; output isolation; and 2,000 deterministic reference-model history operations.
