# Desktop controlled classical sharpening

This candidate integrates the frozen shared `src/sharpness.cjs` core. It is the
byte-identical mobile `app/src/main/assets/sharpness.js` implementation, SHA-256
`44e95137e818d4157370975a795364ee6e303d719c0db4456f71d5e08bc6d707`.
No alternate desktop sharpening formula, model, network request, learned detail,
noise estimator, or resolution enhancement is introduced.

## Recipe and numerical meaning

`settings.sharpness` is null (off) or the strict complete record:

```json
{"version":1,"amount":0,"radius":1,"threshold":3}
```

Amount accepts finite numbers in `[0,100]`, radius `[0.3,3]`, and threshold
`[0,30]`, including fractions. Unknown, inherited, hidden, accessor, symbol, or
missing recipe fields are rejected. A supplied zero recipe is validated, not
silently discarded. Null and zero do not call the core planner or raster apply
in integration, retaining the legacy 64,000,000-pixel inactive native export path.
The core itself caps all image/size calls, so bypassing inactive planning is
intentional rather than weakening the shared core.

Radius means per-axis standard deviation at a 1000-pixel short edge:

`sigmaPixels = radius * min(processingWidth, processingHeight) / 1000`.

There is no minimum pixel-radius clamp. Preview processing is approximate;
resampling, quantization and the fixed 3×3 limiter do not commute with sharpening.
The same recipe does not promise downsampled-export/preview pixel equivalence.

The frozen algorithm decodes sRGB RGB into linear light, computes weighted
linear luminance, then re-encodes that scalar luminance to code values. It blurs
luminance-times-alpha and alpha separately, normalizing coverage. The blur is
three separable fractional-box stages with Gaussian-equivalent variance, not an
exact Gaussian kernel. The soft threshold and bounded detail lift operate on
that scalar luminance. A 3×3 local-range limiter and RGB-gamut limiter attenuate
the desired change; one common linear RGB gain preserves chroma rather than
sharpening encoded channels independently. Alpha remains byte-exact and hidden
RGB at alpha zero is copied without entering neighborhoods. Existing native
export privacy cleanup still clears hidden RGB in the encoded output only.

This is deliberately conservative enhancement of existing edges, not
restoration, deconvolution, denoising, recovery of missing/clipped detail or a
state-of-the-art reconstruction claim. Threshold zero can amplify noise. Tiny
images, flat regions and already-crisp two-color edges may remain unchanged.
The complete numerical definition remains the frozen shared implementation and
its mobile `docs/SHARPNESS-CONTRACT.md`, not a reimplemented desktop approximation.

## Pipeline and immutable source

Actual order is:

1. Healing, beauty/per-person beauty, global tone, light balance, levels and
   advanced tone, local layers, manual liquify/repair.
2. Background composition, global/per-person face reshaping.
3. Active controlled sharpening, on the selected processing source dimensions.
4. Framing/crop/quarter-turn/flip, arbitrary-angle straighten, canvas padding.
5. Text, paint, final redaction, then explicit final export resize.

No text or paint overlay is sharpened. Final redaction remains last among editing
operations. Source image bytes, source RGBA input, recipes, history and cached
analysis are not modified by the sharpening core. Source comparison, manual
source-space editing and light-balance sampling settings omit sharpening.
Portable preset format is not expanded by this milestone.

## Admission and memory

All active entry points use `MintSharpness.plan({width,height}, recipe)` before
raster allocation or application; the argument is an exact size record and must
never include `data` or transient diagnostics. The selected processing source is
capped at 16,777,216 pixels and 16,384 per edge. Existing browser working-source
limits can be stricter. A later crop, tiny output size or final downsize cannot
bypass this source cap.

- Original-size native export inspects source headers and plans before copying
  compressed source bytes, spawning a worker or decoding RGBA.
- Explicit working-size export retains its existing deliberate working-size
  choice. A larger original may be accepted within the legacy 64,000,000-pixel
  input protections, then sharpened on that bounded selected working source.
  The application never silently changes the user's chosen resolution mode.
- The native worker independently checks active plans against encoded-source
  metadata before creating the Sharp decoder. Pure replay plans before source
  editing and honors cancellation.
- Browser `preflightRender({width,height}, settings, analysis, options)` accepts a
  metadata size record. It creates no Canvas, reads no pixels, clones no analysis
  and starts no worker until all checks pass. UI apply and export use this same
  admission function. Browser export must preflight its selected processing size
  before decoding when dimensions are known.

The shared core reports worst-case working storage including output, up to three
Float32 fields, a three-row Float64 buffer and a decode LUT:

`maxWorkingBytes = 16*pixels + 24*width + 2048`.

`maxTotalBytes = 4*pixels + maxWorkingBytes`.

Opaque storage can be lower; admission always uses the conservative maximum.
`workUnits = 24*pixels + 6*(width+height)*(2*boxRadius+1)` is a scheduling weight,
not a wall-clock or allocation estimate. The core's own worst-case working
ceiling is 268,830,720 bytes. The integration also enforces a combined 512 MiB
managed-buffer budget when sharpening or straighten is active:

- Native planning sums original and edited processing-source RGBA planes, the
  sharpness maximum, allocated framing, straighten scratch, padding, text/paint
  composite planes, paint/redaction scratch, explicit final resize output, and
  retained compressed source/analysis/overlay buffers and their owned copies.
- Browser planning sums the source Canvas, transferred readback and edited
  processing-source plane, the same active core maximum and geometry allocations,
  final output/Canvas/ImageData/comparison surfaces, deferred text/paint planes,
  layer scratch, analysis copies and caller-provided `retainedBytes`.
- The pixel worker independently sums its original and edited planes, active
  core maximum, geometry/layer allocations, mask and caller-retained storage.

These are conservative estimates of known retained buffers, not RSS, process
heap limits or guarantees of available memory. They do not assume immediate
garbage collection. `retainedBytes` must be a nonnegative safe integer. A valid
shared-core size can still fail the tighter surrounding combined budget; failure
is explicit, never an automatic downscale. Active browser jobs are serialized
against other renders so independent comparison jobs do not double the budget.
Inactive jobs retain the existing two-worker scheduling policy.

## Cancellation and provenance

The shared core's `shouldCancel` callback reaches native pure replay. Cancellation
can stop before allocations, within blur work or before publication. UI/native
worker termination and settled-job guards discard late/stale completion; an
export cancelled before writing cannot become a saved file. Existing noncancelable
write commit semantics are unchanged.

Only active outputs carry:

```json
{"sharpened":true,"sharpnessRecipe":{"version":1,"amount":50,"radius":1,"threshold":3}}
```

Export details additionally contain `sharpness` equal to
`classical-coverage-normalized-luminance-unsharp-detail` and a matching complete
`sharpnessRecipe`. This is separate from any resampling/straighten description.
The native result gate, browser worker gate and export queue verify the canonical
recipe and active metadata before publishing/writing. Active missing, neutral,
malformed or different recipes fail. Inactive null/zero outputs reject even
neutral-looking extra sharpening fields. Neutral outputs keep the old metadata
shape exactly. The browser pixel worker carries only active top-level provenance;
the caller owns final export details after its overlay stages complete.

## Project persistence and verification

Project format 15 reads versions 1 through 14. Every current, committed, undo,
redo and exported settings slot explicitly owns `sharpness`. Old omitted fields
migrate to null independently. Version 15 omissions and malformed fields fail
on both save and load. Project codec validation is metadata-only: it does not
plan/rasterize sharpening or impose execution caps on large historical source
headers. Original/cache bytes and existing paint/redaction geometry keys survive
migration unchanged. Sharpening does not change geometry-key semantics.

Owned integration tests:

- `tests/sharpness-project.test.cjs`: genuine frozen-v14 fixture, all version
  migrations/history slots, strict malformed data, payload identity, independent
  records, oversized metadata-only project loading.
- `tests/sharpness-pipeline.test.cjs`: real UMD pixel-worker/native pixel agreement,
  observable processing order, source immutability, alpha/hidden RGB, cancellation,
  retained-memory rejection and queue provenance/cancel/retry checks.
- `tests/sharpness-browser-pipeline.test.cjs`: metadata-only production preflight,
  conservative budget counterexamples, snapshot ownership, scheduling, stale
  worker rejection, strict active/neutral provenance and unaffected source views.
- `tests/sharpness-native.test.cjs`: actual Sharp PNG/JPEG encode/decode, overlay
  order, selected working/final-size path, neutral 64MP planning, preallocation
  counters, strict native result provenance and cancellation.

These cloud Node/VM/Sharp checks do not claim installed Windows GUI, keyboard,
font rasterizer, GPU, installer or physical-device acceptance. They also do not
replace independent portrait-image quality review. Candidate 0.2.7 is not a
released replacement for the existing 0.2.6 installers.
