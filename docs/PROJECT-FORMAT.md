# Mint Portrait local project format, version 16 (reads 1 through 15)

`.mintproj` is a self-contained, non-destructive project, not an exported image.
The pure UMD codec is `src/project-document.cjs` (`MintProjectDocument` in the
browser, `require(...)` in Node). It has no third-party dependencies and reuses
our pure validators for optional geometry, tone, local and manual recipes. It
performs SHA-256 validation but no image decoding, inference, model loading, networking,
filesystem access, path resolution, or API calls.

## What is preserved

- The original compressed JPEG, PNG, or WebP bytes, unchanged and not re-encoded.
- Original display filename, MIME, byte size, orientation-applied dimensions,
  and SHA-256 source identity. Names are display data, not filesystem authority.
- Photo IDs and immutable source-revision IDs, selection, current photo, preset,
  edit revision, current and committed settings, and bounded undo/redo history.
- All accepted learned-cache entries, including those referenced only by history,
  model provenance, exact original-pixel geometry, and Float32 probability bits.
- Manual original-pixel matte brush operations, separately in settings/history.
  The codec never bakes a brush result into the original learned alpha plane.
- Optional last/latest matte IDs and the settings last used for export.
- Authored photo review metadata: rating 0–5, neutral/pick/reject flag, one named
  color label, and independent bounded review undo/redo. This does not alter pixels
  or enter adjustment presets. View filtering/sorting is not stored.

No external source path, file URL, execution code, model weights, remote resource,
thumbnail, main-photo working-canvas cache, live job, temporary error, or inference session
is stored. Version16 does embed bounded imported-overlay working RGBA assets as described below. A project can reopen without its old source paths or model runtime.
Rendering or new analysis remains a separate application responsibility.

The codec does not silently discard photos, history, masks, strokes, or unknown
fields. Unsupported, corrupt, or excessive documents are rejected as a whole.
An empty workspace (`photos: []`, `currentId: null`) is valid.

## Public API

```js
const P = require('../src/project-document.cjs');
const encoded = await P.encode(snapshot);           // owned Uint8Array
const reopened = await P.decode(encoded);           // normalized snapshot
const { parts, byteLength } = await P.encodeParts(snapshot);
// parts: [64-byte header, UTF-8 metadata, original/mask sections...]
// Write parts sequentially to an authorized temporary file for lower peak memory.
const header = P.inspectHeader(encoded.subarray(0, 64));
const geometry = P.inspectImage(originalBytes, 'image/jpeg');
```

`encode`, `encodeParts`, and `decode` optionally accept a second argument
`{ sha256: async bytes => lowercaseHexDigest }`. That callback is trusted host
configuration, never project data. A 32-byte Uint8Array/ArrayBuffer digest also
works. By default the codec uses WebCrypto; Node's built-in `crypto` is the
fallback. Missing hashing support is a failure, not a hash-free mode.

Exports also include `VERSION`, `HEADER_BYTES`, `LIMITS`,
`MAX_CONTAINER_BYTES`, `DEFAULT_SETTINGS`, and `ProjectFormatError`.
Validation errors use `ProjectFormatError`; unsupported versions have
`code: 'UNSUPPORTED_VERSION'`. Hash unavailability has `HASH_UNAVAILABLE`.
Ordinary allocation/platform failures can still throw native errors.

### Snapshot interface

The following is a shape illustration, not executable JSON. All listed photo
fields are required unless marked optional. Unknown fields are rejected.

```js
{
  version: 16,
  currentId: null | 'photo-id',
  photos: [{
    id: 'photo-id',
    name: 'original.jpg',
    sourceRevision: 'photo-id:source-0',
    source: {
      bytes: Uint8Array, // ArrayBuffer or Node Buffer accepted on input
      mime: 'image/jpeg' | 'image/png' | 'image/webp',
      width: 3000, height: 4000, // after EXIF orientation
      byteLength: 123456,       // optional input; always present after decode
      sha256: '64 lowercase hex digits' // optional input; always present after decode
    },
    selected: true,
    settings: { /* all DEFAULT_SETTINGS fields, optional learned fields below */ },
    committed: { /* settings snapshot */ },
    undo: [/* settings snapshots, oldest first; at most 40 */],
    redo: [/* settings snapshots, app stack order; at most 40 */],
    revision: 0,
    preset: null | 'preset-id',
    imageAssets: [/* bounded verified embedded RGBA assets; see IMAGE-ASSET-PROJECT.md */],
    review: { /* bounded rating/flag/label and independent review history */ },
    learnedCache: [/* entries below; convert Map.values() to an array */],
    latestMatteId: null | 'matte-id',       // optional
    lastSelectedMatteId: null | 'matte-id', // optional
    exportedSettings: null | { /* settings */ } // optional, not a JSON string
  }]
}
```

Photo/cache/source-revision IDs are bounded alphanumeric identifiers with
`_.:-` separators. Photo IDs and cache IDs are unique throughout the document.
Source SHA-256 and byte length, if supplied at encode time, must match the bytes.
The renderer must convert its existing `exportedSettings` JSON string to an
object before saving and convert it back only after a successful restore.

Settings include the existing exposure/contrast/saturation/temperature,
smooth/brighten/warmth, slim/eyes/nose/jaw, background controls, and up to 64
normalized spot edits. Numeric ranges match the current UI. Optional fields are:

- `learnedMatteId`: cached matte ID or null.
- `learnedMatteStrokes`: at most 64 `keep`/`remove` polyline strokes, each with
  1–512 original-pixel `{x,y}` points, radius, hardness, and opacity. The existing
  deterministic 64-million brush-work bound also applies to each settings state.
- `diagnosticParseId`: cached parsing ID or null.
- `diagnosticOverlay`: boolean. An enabled overlay requires a parsing ID.
- `diagnosticLayer`: `skin` or `protected`.

A matte may be disabled without deleting its stored strokes. Those edits remain
separate from the immutable raw cache; re-enabling behavior is owned by the UI.
Every non-null learned ID in current, committed, undo, redo, exported settings,
or latest/last selection must resolve to the right kind for that photo/source.

### Learned entries

Entries retain the existing application shape:

```js
{
  id, kind: 'matting' | 'parse', photoId, sourceRevision,
  originalSize: { width, height },
  bytes, // exact sum of the plane byte lengths, not a caller-chosen estimate
  result: { /* exact existing validated result shape */ }
}
```

Matting retains `result.matte` with full-image ROI, exact width/height,
`space: 'roi-original-pixels'`, `encoding: 'unit-float32'`, and Float32 `data`,
plus `result.provenance`. Optional `result.kind: 'matting'` is preserved.
Corrected alpha, unaccepted foreground-refinement planes, and unknown extra
results are not accepted as raw learned cache data.

Parsing retains `kind: 'face-masks'`, original-pixel ROI and size, Float32 `skin`
and `protected`, and provenance. It requires the established SegFace vocabulary,
explicit `skin + nose` class union, matching selected face/source revision,
conservative guard policy, and complementary probability planes.

Probabilities must be finite and within `[0,1]`. Planes are persisted as exact
IEEE-754 Float32 little-endian values, not rounded JSON numbers or lossy images.
Restored buffers belong to the new snapshot and do not alias the input file or
another decode. JavaScript typed arrays are mutable: callers must continue to
treat learned planes as immutable and create separate corrected masks.

## Binary layout

All integers in the 64-byte fixed header are unsigned little-endian 32-bit values.
There are no offsets supplied by an external filesystem and no ZIP extraction.

| Byte offset | Size | Meaning |
|---|---:|---|
| 0 | 8 | Magic: bytes `4d 49 4e 54 50 52 4a 00` (`MINTPRJ` + NUL) |
| 8 | 4 | Format version: 16 written; 1 through 15 accepted for migration |
| 12 | 4 | Header length, exactly 64 |
| 16 | 4 | UTF-8 metadata byte length |
| 20 | 4 | Raw payload byte length |
| 24 | 4 | Total file byte length |
| 28 | 4 | Blob count |
| 32 | 32 | SHA-256 of the exact metadata bytes |

The header is followed by compact UTF-8 JSON metadata, then contiguous raw blob
sections. The actual file length must equal the declared total, which must equal
`64 + metadata length + payload length`. Truncation and unknown tail bytes fail.

Metadata contains `format: 'mint-portrait-project'`, version, currentId, photos,
and `blobs`. Binary values in the snapshot are replaced by unique blob IDs.
Each blob descriptor contains:

```json
{"id":"blob-0","kind":"original","offset":0,"byteLength":123456,"sha256":"..."}
```

`kind` is `original` or `float32le`; offsets are relative to the start of the
payload. IDs are sequential, offsets exactly contiguous, every reference is used
once, and every blob must be referenced. Aliases, gaps, overlaps, unknown kinds,
unused blobs, inaccurate lengths, and extra payload data are rejected.

The metadata writer uses compact `JSON.stringify` representation; the reader
requires that representation to round-trip exactly. Duplicate keys, whitespace
variants, alternate number spellings, invalid UTF-8, and ambiguous JSON forms
are rejected rather than interpreted differently by multiple readers.

## Resource and security bounds

| Resource | Hard limit |
|---|---:|
| Photos | 100 |
| Original bytes per photo | 80 MiB |
| Original bytes in project | 400 MiB |
| Learned plane bytes in project | 256 MiB |
| Metadata | 16 MiB |
| Whole container | 672 MiB + 64 bytes (`704643136`) |
| Learned entries across project | 512 |
| Undo / redo, separately per photo | 40 / 40 |
| Original header geometry | 65,535 per edge; 268,000,000 pixels |
| Learned original geometry | 4,096 per edge; 16,000,000 pixels |
| Parsing ROI | 1,048,576 pixels |
| JSON complexity | depth 14; 1,000,000 values |
| Provenance per result | 32 KiB |

These are rejection ceilings, not promises that a maximum-size project fits
low-memory hardware. `encodeParts` avoids an additional whole-file concatenation;
`encode` necessarily allocates a full output container. Both defensively copy
original and mask buffers before asynchronous hashing. On little-endian hosts,
decode owns one additional copy of each blob and uses those same bytes for
Float32 planes. Hash implementations may allocate scratch copies. JSON parsing,
existing Blob/session state, Electron IPC, image decoding, and renderer staging
add memory beyond the codec payload. A maximum-size container can therefore
require well over 1.3 GiB; contiguous encode and concurrent IPC/session copies can
raise this toward or beyond 2 GiB. No low-RAM or unrestricted full-resolution
editing/export claim follows from original-byte preservation.

Image signature and encoded-header dimensions are checked for JPEG/PNG/WebP.
Bounded EXIF/TIFF orientation parsing supplies oriented dimensions for comparison
with the saved decoded dimensions. Ambiguous/malformed headers or duplicate EXIF
blocks are rejected. This is not a replacement for a real image decoder: the
application must stage successful image decodes and verify their dimensions
before replacing its live workspace. Header checks do not validate all compressed
image data or PNG CRCs. Large original sources may still need the existing
bounded preview/export path; learned operations continue to reject originals
above their current 4,096/16MP limits.

Plain-object allowlists, descriptor checks, safe JSON traversal, bounded arrays,
finite numbers, and binary-view checks reject unsafe keys (`__proto__`,
`constructor`, `prototype`), accessors, executable values, custom prototypes,
sparse/extended arrays, unsafe binary subclasses, shared buffers, and cycles.
Provenance extension data is inert bounded JSON; it is never used as executable
code, a path, an import, or an instruction. Unknown schema fields fail
closed. New semantics require an explicitly supported format revision/migration.

SHA-256 detects accidental corruption and binds the metadata to its declared
blob hashes. It is not a signature or authenticity proof: a hostile project
author can recompute hashes and fabricate model provenance. Source-revision,
geometry, class-policy and probability checks establish internal consistency,
not proof that a claimed model was actually run. The project is also not
encrypted: whoever can read it can extract the embedded originals and masks.

## Host integration responsibilities

1. Obtain the source bytes from existing imported Blobs or other authorized
   handles. Do not interpret photo names or project data as local paths.
2. For open, use the privileged system-dialog selection. Stat the file against
   `MAX_CONTAINER_BYTES`, inspect the fixed header, read bounded bytes, and call
   `decode`. Do not trust a filename extension as validation.
3. Stage actual image decodes, thumbnails, and all restored state before any live
   workspace replacement. A failure leaves the current session untouched. Do
   not run models just to deserialize cached data.
4. For save, use the user-chosen project destination, protect original source
   files, validate the codec result, write an exclusive temporary file in the
   destination directory, flush it, and atomically replace the destination.
   Cleanup belongs to the privileged host; the codec never writes a file.
5. Keep project-save cleanliness separate from image-export cleanliness. A
   successful project save is not an image export, and vice versa.

## Tests

Run `node --test tests/project-document.test.cjs`. The suite covers exact
original/Float32/history round-trips, browser WebCrypto UMD loading, independent
buffers, mutation during asynchronous hashing, empty workspaces, bounded counts,
EXIF/header geometry, framing/hash corruption, duplicate-key/prototype attacks,
unsafe binary views, missing history references, source ownership, and invalid
learned probabilities/policies. Fixtures are small synthetic local data. These
tests do not load or execute vendor models and are not image-quality validation.


## Version4 settings migration

The enclosing codec version is4; the advanced-tone recipe has its own independent version1. Version2 added face-color controls and source-bound local layers; version3 added current manual selection plus independent liquify/repair stroke snapshots. Version4 adds `advancedTone: null` by default. On older projects all missing fields receive exact neutral/empty defaults; original compressed bytes, source revision, current/committed state and each undo/redo state are retained. Encoding always writes version4.

A nonnull advanced-tone recipe is strictly validated by `MintAdvancedTone`: fixed five-node master/red/green/blue curves, explicit monotone/free mode, eight circular HSL bands, enabled and strength. Histogram pixels/bins are derived UI state and never serialized. See ADVANCED-TONE-CONTRACT.md. Unsupported recipes fail closed, without executing a file path or importing project code.

Stored manual operations remain subject to current replay safety rules. In particular transparent-source liquify is rejected at pixel replay, and repair uses resolution-independent normalized stroke bounds. An old oversized stroke is not silently clipped, removed, or weakened to make export succeed.

## Version 5: non-destructive final framing

Settings may contain `framing: null` (the neutral default) or an exact shared
`MintGeometry` version 1 recipe: `{version:1,crop:{x,y,w,h},quarterTurns,flipX,flipY}`.
Unknown fields, missing mandatory fields, accessors, inherited values and invalid
ranges are rejected before values are read. The recipe is preserved independently
in current settings, committed settings, undo, redo and exported-settings snapshots.
Versions 1–4 migrate to neutral framing. Source bytes, source revisions and all
original-space masks, meshes, local selections, liquify and repair records remain
unchanged. Desktop applies framing last, after all pixel edits; it does not bake a
crop into the source, shift old brush coordinates, or truncate history.

Crop uses normalized source edges, then deterministic integer edge quantization;
clockwise quarter turns and output-axis flips copy RGBA pixels without resampling.
The preview and original-size render independently quantize at their actual
processing dimensions. Pixel boundaries may differ by one displayed pixel at
small preview sizes; original-size export uses original integer edges.

Document storage validation is intentionally separate from render budgets. A
valid archived source larger than the processing limit is not silently deleted.
Export checks the whole processing source *before* crop: a tiny crop cannot evade
64 MP / 16384-edge general or 16 MP portrait/manual limits. Geometry's standalone
metadata planner has its own 80 MP / 32768-edge limit; the UI must handle oversized
archives explicitly rather than raising during project restore.

Desktop final-framing projects are not interchangeable with mobile ordered raster
projects. The common geometry recipe is shared math, not a shared project format.

## Version 6 review metadata

Every encoded photo now owns `review: {version: 1, current: {rating, flag, label},
undo: [], redo: []}`. The pure `MintPhotoReview` validator is required when an
explicit review is validated. It rejects unknown fields, invalid enums/numbers,
accessors, holes and histories exceeding 40 snapshots per direction. Project
metadata remains within the existing total JSON/node/byte ceilings. The write API
initializes an omitted review to a new neutral record for older callers, but a
version-6 file missing the required field is invalid. It is never silently erased.

Files v1–5 contain no review field and migrate to independent neutral states. An
unexpected review field in such a legacy schema is rejected. Valid old pixel
settings, embedded originals, learned cache, manual histories and framing are
preserved. Earlier applications must reject the newer file version, not open a
partial project. This is not a sidecar/XMP format or automatic quality ranking.

A review command increments the generic photo edit revision to invalidate stale
UI jobs, but never changes the immutable source revision or pixel command history.
Its undo/redo is separate from image-edit undo/redo. Clearing a filter is not an
undo: filters must not secretly discard selections or reorder imported source
records. Export receipts do not mark a project as saved.

## Version 7: explicit Levels recipes

Current settings, committed, everyundo/redo state and exportedSettings now include levels:null or a strictly validated shared MintLevels version1 recipe. Version7 on disk requires the field even whennull. Missing levels in versions1–6 migrate toneutralnull; malformed present recipes reject the entire file. The pixel order is basic tone → Levels → advanced curves/HSL → local layers, then the existing manual/background/reshape/framing stages. Non-null recipes fail closed if the shared validator is missing.

Both header and metadata accept legacyv6 explicitly. Version6 review state remains mandatory when readingv6/v7. Originals, hashes, review, geometry, masks and history ownership are retained. Encoding always writesv7; previous version sections above are historical additions, not the current output version. Frozen reference comparison remains session-only and is never serialized. No autosave or device acceptance is added by this format change.


## v8 and v9 source-only extensions after delivered0.2.3

Version8 adds explicit canvasPadding (null or the shared strict padding recipe) in current, committed, undo, redo and non-null exported settings. Version9 additionally requires textLayers in every one of those slots, as an ordered array of at most8 strict {id,enabled,recipe} layers. See TEXT-LAYERS-CONTRACT.md. Text recipes are editable records; no raster overlay or cached glyph bitmap is serialized. Aggregate text is bounded4000Unicode codepoints per settings snapshot, each recipe500codepoints, with existing project byte/photo/history limits still in force.

Reading1–7 supplies missing padding=null and textLayers=[]. Reading8 requires padding and migrates missing textLayers=[]. Present but malformed fields in any version are rejected, not discarded. Reading9 requires both fields even for neutral settings. Encoding now always writes9; version-specific sections above document historical migrations. Header and JSON metadata versions must agree and hashes/lengths are recomputed and verified as before. Delivered0.2.3 accepts at mostv7 and cannot open later source projects. Original compressed image bytes remain unchanged and no system font/path is embedded.


## Historical v10–v12 extensions

- v10 adds neutral-or-validated lightBalance in every settings/history slot.
- v11 adds source/geometry-bound redactions, retaining original bytes and recipes.
- v12 adds source/geometry-bound paintLayers. Every current, committed, undo, redo and exported-settings slot must own the field; null is the neutral representation. Versions 1–11 migrate this new field to null without changing original bytes or earlier edits. Missing current-version fields, malformed metadata and stale bindings fail closed.

Paint persists four bounded transparent-layer recipes and their independent original-source selection snapshots, not transient Canvas/RGBA payloads. Native export paintOverlay is ephemeral and never a project field. See PAINT-DESKTOP-UI.md and PAINT-LAYERS-CONTRACT.md for stage order, dimensions, selection geometry, limits and privacy. Delivered0.2.5 writes v11; v12 is a newer unpublished source increment, so keep backups before upgrading projects.


## Current v16 and intervening v13–v15

The sections above record historical additions, not the current writer version. Current output is v16; the header and JSON version must agree. v13 added explicit per-person batches, v14 arbitrary straighten, and v15 traditional sharpness. All present recipes remain strictly validated, including legacy documents; old versions receive only documented neutral defaults.

v16 adds required settings.imageLayers arrays and photo.imageAssets tables. Layers are editable final-canvas recipes, while raw verified RGBA assets are deduplicated per photo into framed binary blobs. Every current, committed, undo, redo and exported-settings reference, including hidden layers, must resolve. Reading v1–v15 supplies empty layers/assets without discarding original bytes or existing edits. SHA integrity, original-image recovery, atomic save, total container and cumulative cache budgets remain enforced. See IMAGE-ASSET-PROJECT.md and DESKTOP-IMAGE-LAYERS.zh-CN.md for exact limits and privacy. New v16 projects cannot be opened by delivered0.2.7 (v15); retain older backups.
