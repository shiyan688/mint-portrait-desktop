# Desktop final-canvas redaction layers, version 1

`src/redaction-layers.cjs` is the pure UMD `MintRedactionLayers` adapter. It has no model, network, filesystem, font, or platform dependencies. Its only dependencies are the existing shared `MintRedact`, `MintManualTools`, `MintGeometry`, and `MintCanvasPadding` modules. Browser hosts must load these dependencies before the adapter. CommonJS and AMD are supported.

## Frozen shared core

The adapter explicitly selects `MintRedact.createProfile('desktop')`. It does not change the mobile default, recipe format, capsule coverage, rounding, mosaic cell sampling, cover opacity, alpha treatment, or cancellation mathematics.

The frozen `src/redact-core.cjs` SHA-256 is:

`14abf070ebc42e9942e4a847d672ff4a53c1769ee66276de4e24ff86e6b62be8`

The core retains its existing 16,777,216-pixel / 16,384-edge desktop limits, 64,000,000 work-pixel limit per call, and 128 MiB extra-memory ceiling. The adapter adds cumulative limits; it does not raise a core limit.

## Public API

- `defaults()` returns `null`.
- `geometryKey(settings)` returns bounded canonical JSON of normalized `framing`, `canvasPadding`, `manualLiquify`, `slim`, `eyes`, `nose`, and `jaw`. This is the actual canonical representation, not a collision-prone hash.
- `validate(value, context)` returns an independent, recursively frozen canonical collection, or `null`. It verifies source and geometry binding but allocates no pixel raster. Non-null collections require the full context below.
- `isActive(value)` strictly validates collection structure and returns whether any enabled layer has nonempty recipe strokes. It has no context argument and therefore does not authorize replay or establish source/geometry compatibility.
- `plan(width, height, value, context)` validates and returns a recursively frozen resource plan, without allocating pixel rasters. Width and height are the final canvas, before output resizing. The plan includes `width`, `height`, `pixels`, `active`, `layerCount`, `activeLayers`, `strokeCount`, `totalPoints`, `workPixels`, `extraBytes`, and per-layer `{id, active, workPixels, extraBytes}` entries in `layers`.
- `apply(image, value, context)` returns only a plain `{width, height, data}` image, without side diagnostics. Null, empty, all-disabled, and all-empty-stroke collections return the exact input object and data identity, after validation and cancellation checks.
- `LIMITS` is frozen and exposes the adapter's bounds.

Context:

```js
{
  sourceRevision: 'immutable-source-identity',
  settings: currentSettings,
  sourceSize: { width: processingWidth, height: processingHeight },
  shouldCancel: optionalTrustedFunction
}
```

`sourceSize` means the actual pre-geometry processing raster. A reduced working export or preview supplies its working dimensions; an original-resolution export supplies original dimensions. Do not supply original dimensions for a smaller processing raster. Immutable source revision does not change merely because the processing resolution or ordinary editing history counter changes.

For null operations, context may be omitted; a supplied context is still descriptor-validated. Cancellation callbacks are optional functions, not truthy flags.

## Exact collection schema

```js
{
  version: 1,
  sourceRevision: 'immutable-source-identity',
  geometryKey: MintRedactionLayers.geometryKey(currentSettings),
  layers: [
    {
      id: 'redaction-1',
      name: '遮挡 1',
      enabled: true,
      recipe: {
        version: 1,
        mode: 'cover',
        blockSize: 0.04,
        color: '#173e31',
        strokes: [{ radius: 0.1, points: [{ x: 0.5, y: 0.5 }] }]
      },
      selection: null
    }
  ]
}
```

`null` is the unrestricted/absent collection default. A layer's selection is either `null` or the existing canonical source-bound `MintManualTools` selection recipe. Each layer independently snapshots its selection. Later changes to the current selection or another layer cannot modify that snapshot.

Records require exact own enumerable data fields; layer arrays must be dense ordinary arrays (null-prototype arrays are accepted and normalized). Accessors, hidden fields, symbols, inherited required fields, unexpected fields, unsafe prototypes, sparse/extended arrays, duplicate IDs, nonfinite numbers, and oversized inputs reject without evaluating input getters. Manual recipe inputs first pass a bounded descriptor-only copier before invoking the existing shared validator.

IDs use the existing alphanumeric / underscore / hyphen / period / colon convention, are at most 160 characters, and reject reserved prototype names. Names are nonempty, at most 80 characters, and contain no ASCII control characters. Source revisions are nonempty bounded strings of at most 160 characters, with no ASCII control characters.

An image must be an exact plain record with own `width`, `height`, `data`. Data must have the native `Uint8Array.prototype` or `Uint8ClampedArray.prototype` and exact RGBA length, backed by an attached, fixed, non-shared ordinary ArrayBuffer. Buffer, typed-array subclasses, shared/resizable/detached buffers, and other numeric representations reject. Hosts must normalize native Buffer data to an ordinary Uint8Array before this boundary. Typed-array metadata is read through captured intrinsics, not shadowable getters or iterators.

## Source and geometry binding

Absent framing is normalized to shared default geometry; absent/null padding to shared default padding; absent liquify to `[]`; and absent shape controls to zero. Shared validators canonicalize their respective recipes. Nongeometric settings, text, color adjustments, current selection, and ordinary history counters do not change the key.

The key is capped at 32,768 characters, matching the existing project codec's metadata-string bound. Excessive liquify geometry therefore fails before a redaction collection can be accepted in the UI but rejected only on save. There is no lossy shortening or hash fallback.

Any non-null collection, including an empty or all-disabled collection, remains source- and geometry-bound. A mismatch rejects; validation and application never relocate, clear, rescale, or regenerate stored strokes. The UI must explicitly remove/clear the collection before changing incompatible geometry, or require the user to choose another deliberate workflow. Merely disabling every layer does not permit silent rebinding.

Selections are not warped through manual liquify or automatic facial shaping. Selected collections reject any nonzero `slim`, `eyes`, `nose`, or `jaw`, or any manual-liquify command with nonzero strength. Zero-strength liquify commands remain represented in the key but do not create this unwarped-selection conflict. Unselected final-canvas redaction may coexist with shape adjustments as long as its saved geometry key matches.

## Stage and pixel semantics

Replay order is:

1. Existing source-space edits and portrait processing.
2. Shared integer crop, clockwise quarter turns, output-axis flips, and canvas padding.
3. Final-canvas text compositing.
4. Redaction layers in stored order.
5. Final output resizing and encoding.

Redaction strokes are normalized to the full final canvas, including padding, not the original source image. An unselected layer can redact text and padding. The host must not pass an already output-resized image to this stage.

For a selected layer, the adapter rasterizes its captured selection at `context.sourceSize`, then treats each exact Float32 mask element as four opaque bytes. Shared geometry and padding transport those four channels by bitwise byte copy. Padding uses zero RGBA fill, independent of the visible padding's color and opacity. The transported bytes are reinterpreted as Float32, with no interpolation, gamma conversion, alpha blending, 8-bit mask quantization, or feathering a second time. Output dimensions must exactly match the final canvas.

Each layer calls the frozen core against its immutable input raster. A later layer reads the previous layer's completed result, not a partially modified mosaic cell. Selection clips the resulting layer once:

- Weight zero restores all four original layer-input bytes exactly, including hidden RGB.
- Cover requires `selection.feather === 0` and a strictly binary transported mask. A fractional, nonfinite, or out-of-range mask fails closed. Hit pixels remain exact requested RGB with alpha 255, even over transparent source pixels. Cover never opacity-blends.
- Mosaic allows fractional selection weights. It blends only RGB once between the layer input and the core's completed result, using Uint8ClampedArray rounding; original alpha is preserved. The core's alpha-weighted, origin-anchored whole-cell sampling remains unchanged.

The caller's original image, source bytes, recipes, and stored selections are never mutated. Cancellation throws an AbortError without exposing partial output. A callback that detaches a source buffer fails closed even if it returns false.

## Resource limits

- At most 8 layers.
- Aggregate redaction recipes contain at most 64 strokes and 4,096 points, including disabled layers.
- Every selection retains the existing ManualTools limits of 128 commands and 4,096 points. Liquify metadata retains its existing command/point/snapshot limits.
- Final canvas: at most 16,777,216 pixels and 16,384 pixels per edge, even for neutral operations.
- Selected source raster: independently at most 16,777,216 pixels / 16,384 per edge. A tiny crop cannot bypass the source-selection bound.
- Unselected source-size metadata can describe up to 268,000,000 pixels / 65,535 per edge; no source-selection raster is allocated in this case.
- Cumulative active work: at most 128,000,000 work-pixel units, including each core's work, selection raster estimate, geometry/padding transport, mask validation, and one clip pass.
- Extra live-memory estimate: at most 128 MiB, including retained intermediate layer output, active core allocations, mask/scratch/transport buffers, and conservative metadata allowances. Caller-owned input image storage is excluded. Limits are independent ceilings, not a guarantee that every combination of maxima is simultaneously feasible.
- Each core call still independently enforces its own frozen 64,000,000-work / 128 MiB limits.
- Settings have at most 128 own fields; descriptor-only copied trees have at most 100,000 nodes and bounded depth. Geometry keys have the 32,768-character limit above.

All cumulative plans, per-call core plans, source bounds, selected output-size checks, and cancellation checks precede pixel allocations. Inactive layers consume no raster work but still receive full structural/source/geometry validation. The manual selection work estimator mirrors the shared module's private estimator because that helper is not exported; a future shared-selection algorithm change must update and test this estimate too.

## Focused verification

Run:

```sh
node --test tests/redaction-layers.test.cjs tests/redact-core-desktop.test.cjs tests/manual-tools.test.cjs
```

The adapter tests cover strict records and getter safety, UMD entries, canonical geometry keys, stale source/geometry rejection, unwarped-selection restrictions, identity paths, opaque cover over transparency, weight-zero byte invariance, single feather blend, independent crop/turn/flip/padding mapping, exact mask transport, layer order, independently captured selections, resource rejection, cancellation, source detachment, and original-source immutability. All fixtures are synthetic; no private photographs, remote APIs, or learned models are used.
