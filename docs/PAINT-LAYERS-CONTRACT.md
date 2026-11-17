# Desktop paint collection and renderer contract

## Scope and provenance

`src/paint-layers.cjs` exports `MintPaintLayers`; `src/paint-layer-renderer.cjs`
exports `MintPaintLayerRenderer`. The collection is a desktop adapter over the
named `MintPaintLayer.createProfile('desktop')` profile, not a new brush engine.
It does not alter the shared mobile/default profile or brush/eraser mathematics.
It does not decode images, read photos, fetch resources, load fonts, or acquire
filesystem/export authority. Transparent paint is a distinct `paintOverlay`,
never text provenance.

## Persistent collection

The only identity/default representation is `null`. Non-null values contain
exactly:

```js
{
  version: 1,
  sourceRevision: 'source:1',
  geometryKey: MintPaintLayers.geometryKey(settings),
  layers: [{ id: 'paint1', name: '画笔 1', enabled: true,
             recipe: { version: 1, strokes: [] }, selection: null }]
}
```

Layer order is bottom-to-top. IDs are unique bounded identifier strings. Names
are 1–80 UTF-16 units without control characters. At most four layers may be
stored, including disabled layers. Stored recipes share aggregate limits of
128 strokes and 8192 points, including disabled layers. Each recipe is validated
by the unchanged shared core (1024 points/stroke, width 0.002–0.12, opacity 0–1,
normalized points, paint/erase modes, canonical lowercase `#rrggbb`).

Records are exact plain/null-prototype data records. Dense arrays are checked by
descriptor, with no unexpected properties. Getters, setters, hidden fields,
custom array prototypes, symbols, sparse arrays and unsafe keys are rejected
without reading accessor values. Selection metadata is bounded by depth 12 and
100000 visited nodes per snapshot before entering the older shared validator.
`validate` returns independent recursively frozen snapshots. It never changes
the supplied collection, settings, selection or source image.

## Binding and source selections

Context is exactly `{sourceRevision, settings, sourceSize: {width, height}}`,
optionally with a `shouldCancel()` callback. Every non-null collection requires
context. Empty and disabled collections still reject stale source or geometry.
The geometry key delegates to the frozen redaction geometry-binding function,
covering framing, padding and auto/manual warp, not color adjustments or a
history counter.

Every layer captures its own nullable source-selection snapshot using
`MintManualTools.validateSelection`. A non-null selection is never silently
ignored. Selected collections reject active automatic shape changes, active
manual liquify, stale liquify source revisions, and selected source rasters over
16,000,000 pixels or 16,384 on either edge. This applies even to disabled selected
layers so that toggling them cannot revive an invalid source binding.

At render time the existing ManualTools rasterizer produces Float32 weights.
The weights' four bytes are transported exactly by `MintGeometry` crop,
clockwise quarter-turns and output-axis flips, then by `MintCanvasPadding` with
zero padding bytes. They are not interpreted as colors, resampled, or blended.
Transported dimensions must exactly equal requested final dimensions. Padding
is therefore unselected, even for an all-source selection. Without a selection,
metadata sources up to 268,000,000 pixels / 65,535 edge can be represented when
legitimate framing produces a bounded final image; no source mask is allocated.
Other pipeline/source-decoder limits still apply independently.

Each layer first renders its entire paint/erase recipe on its own transparent
surface. The captured mask multiplies that completed layer's alpha exactly once:
`alpha = round(alpha * weight)`. It does not scale RGB, repeatedly clip strokes,
or attenuate the source photograph. Zero-alpha overlay pixels have zero RGB.
Only then is the completed overlay composed source-over in collection order.
An eraser can affect only its own paint layer, never lower paint layers, text,
redaction, or the photograph.

## Public collection API

- `LIMITS`: frozen limits.
- `defaults()`: `null`.
- `geometryKey(settings)`: canonical source-geometry binding.
- `validate(value, context)`: deeply frozen independent snapshot or `null`.
- `isActive(value)`: structurally validates, then reports an enabled positive-
  opacity paint stroke. Empty, disabled, zero-opacity and erase-only recipes do
  not allocate a raster. This is not a substitute for context validation.
- `plan(width, height, value, context)`: validates all metadata and computes the
  whole-collection resource plan before any pixel allocation.
- `canonicalRecipe(value)`: deterministic JSON of canonical structural data,
  including source/geometry, names, enabled flags, recipes and captured selections.
  Maximum length is 2,000,000 UTF-16 units. This does not replace context binding.
- `render(width, height, value, context, {createCanvas, shouldCancel})`: synchronous
  reference implementation, returns frozen `{width,height,rgba:Uint8Array}` or
  `null`. Optional factory must return a fresh, exact-sized disposable Canvas
  for every call, including internal erase tiles. Every issued surface is tracked
  by a WeakSet, disposed after use and rejected on reuse. The caller owns only
  the returned raster, never an intermediate canvas.

## Resource planning

Final raster limits are exactly 16,000,000 pixels and 16,384 pixels/edge. No
implicit resizing/downsampling is performed. All enabled active recipes are
planned before rendering. Aggregate eraser rectangle visits may not exceed
32,000,000. Inactive recipes still count against stored stroke/point limits,
but consume no execution budget.

The plan also limits aggregate conservative logical visits to 256,000,000 and
managed extra-buffer peak to 256 MiB. The memory estimate includes two canonical
metadata snapshots plus a 2 MiB scratch allowance. Each layer exposes its
`canvasBytes`, `rgbaBytes`, `eraseScratchBytes`, `retainedBytes`,
`selectionRasterBytes`, `selectionTransportBytes`, `eraseWorkPixels`,
`workPixels`, and `extraBytes`. Global totals include all stored strokes/points,
active layers, cumulative erasure/work and maximum extra-buffer peak.

For `N = width*height` and `T = max erase-tile pixels`:

- Native paint canvas: `4N` bytes.
- Readback peak: canvas + ImageData + owned copy = `12N` bytes.
- Erasure peak: canvas + mask canvas + two tile readbacks = `4N + 12T` bytes.
- Retained lower-layer raster: `4N` bytes, except for the first active layer.
- Source selection: `4S` bytes without feather, `8S` with feather, plus
  `(max(sourceWidth,sourceHeight)+1)*8` for integral-line work.
- Selection transport: max of source/destination overlap for geometry and
  geometry/final overlap for padding; current and retained paint rasters remain
  charged throughout. Each layer is completed before the next starts.

Logical work includes full-frame clear/readback, antialias-expanded stroke
segment rectangles, path replay per eraser tile, full erase-tile clear/draw,
erase read/edit/write, exact ManualTools selection-cost estimate, geometry and
padding transport, mask validation/application, sanitation and composition.
Conservative plan rejection is intentional. A valid recipe may exceed resource
budgets at a large final resolution and must be simplified or explicitly
rendered at a smaller caller-selected resolution.

These are managed-live-buffer/logical-work bounds, not promises about total
process RSS, browser/GPU/native temporary allocation or garbage-collection
latency. The asynchronous renderer below additionally snapshots raster bytes,
sanitizes transparency and composes layers, with bounded per-layer linear
passes. Native Canvas can defer releasing backing stores until an event-loop
turn. The synchronous collection renderer is a reference primitive; use the
asynchronous renderer for application workflows, rather than chaining large
synchronous renders.

## Renderer API and lifecycle

```js
const service = MintPaintLayerRenderer.create({document, crypto, layersCore});
await service.raster({layers, context, width, height, signal, isCurrent});
await service.envelope({requestId, sourceRevision, sourceBytes, layers, context,
  width, height, mode, signal, isCurrent, preparedRaster, preparedRecipeHash});
await service.hashBytes(bytes, {signal, isCurrent});
service.compositePreview(baseCanvas, raster, {signal, isCurrent});
```

`document`, `crypto`, and `layersCore` are local host dependencies; omitted
values use their corresponding browser globals. The preview compositor reuses
`MintTextLayers.composite` only as a shared straight-sRGB math primitive, not as
text metadata/provenance. No font-readiness APIs are consulted.

The renderer snapshots context and recipes before the first await. It preflights
the entire collection before allocation, then renders one independent layer per
cycle. It yields an event-loop turn before and after synchronous native work,
after owned surfaces are disposed, and before final publication. Thus a real
queued abort/navigation during CPU work is observed before returning bytes or
starting the next layer. Late digest rejection is consumed, pending digest
cancellation rejects promptly, and `isCurrent`/context cancellation is polled.
There is no partial-result publication.

Each source byte input is snapshotted with intrinsics. Accepted storage is native
Uint8Array/Uint8ClampedArray, or ArrayBuffer for hashing. Buffers, subclasses,
proxies, shared, detached, resizable and oversized actual backing allocations
are rejected. Shadowed typed-array metadata/iterators are not executed. Encoded
source storage is bounded by 80 MiB; RGBA storage by 64,000,000 bytes. Prepared
raster and hash must appear together, dimensions must match exactly, and the
canonical recipe SHA-256 must match. Prepared bytes are copied and zero-alpha
hidden RGB is sanitized, without modifying caller storage.

Envelope shape remains exactly:

```js
{version:1, requestId, sourceRevision, sourceHash, recipeHash,
 mode, width, height, rgba}
```

`mode` is `original` or `working`. Revision must match the context and collection.
Source hash is SHA-256 of the original encoded source bytes; recipe hash is
SHA-256 of canonical paint JSON. This is an association guard, not a proof that
an arbitrary renderer or prepared raster honestly executed that recipe. The
export boundary must bind request ID, source hash/revision, recipe, mode and
final dimensions and carry the envelope in the distinct `paintOverlay` field.

Preview never mutates its base canvas. Same-size previews use raster bytes
directly rather than a needless canvas roundtrip. Different preview sizes use
owned smoothing scratch surfaces, then straight-sRGB source-over. Successful
preview output transfers ownership to the caller; all other image canvases are
disposed, including on cancellation/failure. Borrowed source canvases and already
issued output canvases are protected against a malicious/reusing host factory
before any width/height mutation.

## Verification and limitations

`node --test tests/paint-layers.test.cjs tests/paint-layer-renderer.test.cjs`
requires the already installed native `@napi-rs/canvas` backend; absence fails,
with no optional-native skips. Tests include actual synthetic native pixels,
independent source-over and Float32 mask mapping, all 16 turn/flip combinations,
feather clipping, eraser isolation, invalid metadata/real byte backing,
preallocation budgets, disposal/factory reuse, prepared envelopes, queued
post-CPU cancellation and asynchronous inter-layer yielding.

This is Linux/native synthetic raster and orchestration evidence, not Windows
installer/Electron UI acceptance. Native antialiasing can differ by backend and
at tiled eraser boundaries; no universal mobile pixel-delta threshold is claimed.
No dependencies, models, private photographs or network resources are introduced.
