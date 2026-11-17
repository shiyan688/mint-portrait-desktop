# Desktop final-output size contract

## Scope

This is an explicit, final-file downsize, not a processing/source-basis selector.
It is an export request property, never a project setting, edit-history entry or
preset. Existing `mode: 'original' | 'working'` still chooses processing size.
Source bytes and editable text recipes are not modified.

The optional native request property is:

```js
outputSize: { version: 1, mode: 'unchanged', longEdge: null }
// or
outputSize: { version: 1, mode: 'long-edge', longEdge: 1600 }
```

All three recipe keys must be own enumerable data properties. Missing fields,
additional fields/symbols, accessors, custom prototypes, null/undefined, unsupported
versions/modes and invalid numbers are rejected, not normalized. Long-edge values
are safe integers from 1 through 16384. Request omission is permitted; an explicitly
present `outputSize: undefined` is not omission. Recipe objects are snapshotted.

## Planner and budgets

`src/export-size.cjs` is dependency-free UMD: CommonJS plus browser `MintExportSize`.
The public API is `LIMITS`, `defaults()`, `validate(recipe)` and
`plan(compositionWidth, compositionHeight, recipe)`.

The planner returns:

```js
{
  recipe, input: { width, height }, output: { width, height },
  resized, requestedEdge, scale,
  allocation: {
    bytesPerPixel, inputBytes, outputBytes, extraBytes, peakBytes,
    pairBytes, maxPairBytes
  }
}
```

Desktop input and output remain at most 64,000,000 pixels with a 16384-pixel edge.
The planner's conservative two-raw-buffer bound is 512,000,000 bytes, not mobile's
64 MiB pair limit. Allocation values describe only this stage's RGBA input/output,
not the entire native process's peak memory, codec scratch, masks or earlier edits.
Identity needs no additional resize raster.

Before planning this final stage, the native core applies all existing checks:

1. Encoded source is at most 80 MiB; owned backing storage remains bounded and fixed.
2. Source dimensions are at most 64,000,000 pixels and 16384 per edge, even when
   working-size or a tiny final output was selected.
3. Existing original/working processing selection and 16,000,000-pixel complex-edit
   limits remain unchanged.
4. Framing and padding must produce an admissible full composition. Padding does
   not silently shrink the processing image to fit a later output request.
5. Active text still requires a pre-resize composition of at most 16,000,000 pixels
   and 16384 per edge, with an independently owned fixed RGBA overlay backing buffer
   no larger than 64,000,000 bytes.
6. Only then is the requested final output validated and planned.

Final encoded output still has the existing 80 MiB limit. Tiny requested dimensions
cannot make an oversized source, expanded canvas, text canvas or complex intermediate
admissible. This is not a streaming/tile-based renderer.

## Dimension semantics

Upscaling is rejected. Equal-edge requests are accepted without resampling. When
reducing, the requested long edge is exact, and the short edge is positive half-up
rounding with a minimum of one pixel:

```js
Math.max(1, Math.floor(
  (2 * inputShort * requestedLong + inputLong) / (2 * inputLong)
))
```

All intermediate arithmetic is exact for supported desktop dimensions. Aspect
ratio changes only by unavoidable integer quantization. For example, 10×5 → long
edge 5 produces 5×3; 16×1 → long edge 3 produces 3×1. Width/height are passed
explicitly with Sharp `fit: 'fill'` to honor that integer plan, rather than asking
the codec to choose its own rounding, crop or letterbox.

Desktop and Android share recipe meaning and this rounding semantic, not budgets
or byte-identical implementation. `tests/export-size-core.test.cjs` includes a
15-row shared-domain table executed against the mobile planner whose SHA-256 is
`2144c3213ea320a92fb1fd174988f27a0b62cff7e4fcc2647c4cef0b7e5d7e6c`.
The table is self-contained; desktop tests do not require mobile files. Desktop
tests also cover admissible dimensions beyond mobile's 4096 edge / 8 MP limits.

## Native plan and text binding

`Core.sizePlan(width, height, mode, settings, outputSize?)` retains the exact old
plan shape for omitted or explicit `unchanged` requests. The old `scaled` flag
continues to mean original-to-working processing reduction, not final-file resize.

For a `long-edge` request, it additionally returns:

- `compositionWidth`, `compositionHeight`: dimensions after edits/framing/padding.
- `outputSizePlan`: the full final-stage planner result.
- `width`, `height`: final encoded output dimensions.
- Existing `processingWidth`, `processingHeight`: pre-framing processing dimensions.
- Existing `originalWidth`, `originalHeight`: EXIF-oriented source dimensions.

Text envelopes continue to bind request ID, source revision, actual encoded-source
hash, text-recipe hash, original/working mode and PRE-resize composition dimensions.
No text layout, font loading or glyph rasterization occurs in the native final
resize. The complete text-composited bitmap is reduced together. A smaller overlay
matching only final output dimensions is rejected. The hash envelope associates
the raster with its request; it does not prove which glyphs the raster contains.

The renderer independently checks returned plan metadata and decodes the encoded
output's dimensions before publishing the result. Missing/altered final-size fields
or a buffer with plausible but incorrect envelope dimensions fail closed.

## Native pixel pipeline

1. Decode source once, auto-orient EXIF, convert to 8-bit sRGB RGBA.
2. Apply an explicitly selected working-size resize, if needed, as before.
3. Run existing edits, framing, padding and raw RGBA text composition in order.
4. For an actual final reduction only, start a new Sharp raw RGBA pipeline with
   `premultiplied: false`, explicit dimensions, `fit: 'fill'`,
   `kernel: 'lanczos3'`, `withoutEnlargement: true`, and request uchar raw output.
5. Check returned width, height and four channels.
6. Zero RGB for every alpha-zero output pixel AFTER resize.
7. Start a fresh encoder, embed sRGB; for JPEG flatten onto white LAST and encode
   with the existing quality and 4:4:4 settings. PNG retains partial alpha.

Omitted, explicit unchanged and equal-edge outputs do not take the new raw resize
roundtrip. Tests verify byte-for-byte PNG/JPEG neutral parity, including details.
For actual reduction, `details.resampling` is `explicit-final-output-lanczos3`, or
`explicit-working-size-lanczos3+final-output-lanczos3` when both stages ran.

Installed official Sharp 0.35.5 was inspected locally, with no installation or
network access:

- `node_modules/sharp/dist/resize.cjs`: one resize per pipeline, explicit fit/kernel
  semantics, no-enlargement option and default Lanczos3. We pin the kernel explicitly.
- `node_modules/sharp/dist/input.cjs`: raw input defaults to non-premultiplied data;
  this stage sets it explicitly.
- `node_modules/sharp/src/pipeline.cc`: resize premultiplies alpha and later
  unpremultiplies; flatten executes BEFORE resize inside a single pipeline.

The separate resize and encode pipelines are necessary to guarantee final white
flatten order. A native adversarial JPEG test confirms the wrong one-pipeline
flatten/resize order gives different output. The stage works in the existing
8-bit sRGB convention, not linear-light resizing. Lanczos ringing and integer
quantization are expected resampler characteristics, not new image-edit effects.

## Cancellation and verification

The existing isolated worker owns decode, edit, final resize and encoding. Existing
worker termination cancels all of them, releases the service and prevents stale
publication. Source/overlay transfers still use main-owned copies, not caller
buffers. No file-writing, installer, network, dependency or model changes are part
of this feature.

Run focused checks without a package runner:

```sh
node --test tests/export-size-core.test.cjs tests/export-size-native.test.cjs
```

Coverage includes strict/adversarial records; mobile semantic table and exhaustive
small integer plans; desktop-specific limits; actual PNG decoding; transparent
colored-edge invariance; alpha-zero cleanup; one-pixel/half-up output; neutral byte
parity; EXIF orientation; effects/framing/padding/text before resize; explicit
working-size plus final output; JPEG ordering; source/recipe ownership; oversized
source/intermediates/backing buffers; worker-result mismatch; and cancellation.

This evidence is from native Linux Sharp worker execution in the development
environment. It does not claim Windows/Electron UI, browser-engine pixel parity,
installer execution or physical-device testing. Test text overlays are synthetic
RGBA binding fixtures; the existing real-font integration suite is separate.
