# Perspective pipeline integration qualification

Local synthetic cloud qualification only. These results are not evidence of real-browser, Electron UI, Windows installer, GPU or device acceptance. No user photographs, network access, new software, or new model were used.

## Shared implementation

`src/perspective.cjs` is byte-identical to the frozen MintPerspective 1.0.0 mobile core, SHA256 `3a3b57ea8da4ce4a7c99b180a454e9f00a4242a0460621d267ad5487fbe66557`. The desktop adapter contains no alternative projective math or resampler.

Stage order is source-space photo edits and sharpening, framing, straighten, perspective, padding, image, text, paint, redaction, then explicit final-file resize. Perspective receives only a strict native RGBA record. Source selections, learned masks, landmarks, manual source edits and assets are not passed through the perspective filter. Captured final paint/cover selections are rejected even if the layer is disabled/empty or a nonneutral perspective happens to produce an exact copy.

Output fractions apply to the complete post-straighten input. No desktop perspective adapter passes `maxSide`. Processing, perspective, composition and final-file dimensions remain separate. Padding percentages use the perspective output short edge. Source/upstream limits still apply when the declared output or final file is one pixel.

## Canonical active-only receipt

Native top-level result and `details` both contain `perspectiveReceipt`. Browser metadata admission exposes `perspectiveMetadata.perspectiveReceipt`; a validated `Pipeline.render` output Canvas gets a read-only, deeply frozen `perspectiveReceipt`. Later compositors may create a different Canvas; their caller must preserve the already-validated receipt if it needs final provenance.

The exact fields are `version`, `recipe`, `inputWidth`, `inputHeight`, `outputWidth`, `outputHeight`, `kind`, and `resampling`. Version is 1. Recipe is the detached canonical full core recipe; input is post-straighten and output is pre-padding. Kind is core `identity`, `copy`, or `resample`; actual active recipes in this adapter use copy/resample. Resampling is `none` for exact copies, otherwise `linear-light-premultiplied-alpha-mip-anisotropic-bilinear`. Native details additionally identify `perspective` as `exact-byte-copy` or that filter string. The general resampling-stage list includes perspective only when it actually resamples.

Null, omitted legacy settings and exact neutral recipes do not emit any perspective receipt or native perspective detail. Active same-size copies still require their active receipt. Unexpected, missing, altered, extended or same-sized wrong-recipe receipts fail before browser output Canvas allocation or native output publication. Core-issued plans stay local and are never transported or reused as mapping capabilities after structured cloning.

## Admission and cancellation

Metadata preflight adds the core output plus all retained Float32 mip levels and its static table to existing cumulative host budgets. Native source ceiling remains 64,000,000 pixels and preview ceiling remains 16,777,216 (the existing browser working-input admission is 16,000,000). Edges remain 16,384. The core's independent work cap is enforced even if memory would fit. Encoded inputs, full retained backing buffers, comparison surfaces, overlays, text/paint and final resize allocations remain separately charged by their host adapters. A fixed subview cannot hide retained backing bytes.

Main native admission precedes source copying and worker creation. Native worker independently reparses original encoded dimensions and replans every stage before invoking Sharp decode. Browser active geometry work is serialized with comparisons. Cancellation/stale-worker handlers reject results; native termination prevents publication, and pure replay checks cancellation through the core and once after final composition. Source bytes are not changed.

## Reproduction and independent controls

Current focused result: 41/41 perspective pipeline tests and 92/92 relevant legacy pipeline/native tests pass, with no skips. The perspective run includes the installed NativeCanvas glyph and paint raster test composed after perspective and padding, then verified through the real Sharp PNG worker. These counts are focused integration runs, not the full application aggregate. Full logs are `pipeline-test-results.txt` and `pipeline-legacy-regression-results.txt`.

- `node --test tests/perspective-pipeline*.test.cjs`
- `node quality/perspective-qa/pipeline-fixtures.cjs`

The tests include independent integer-crop and scalar affine pixel-edge/linear-light/alpha oracles, independent half-up dimension expectations, byte-identical neutral PNG/JPEG checks, real worker-code VM replay, real Sharp codec replay, malformed recipe/receipt attacks, missing core, allocation counters, source-edge/upstream/cumulative-mip/work-budget attacks, selection rejection, source-space selection invariance, and stale/cancelled jobs.

The full stage-order test makes every late layer visible and verifies a wrong image/text ordering changes bytes. The included generated grid fixture has post-straighten, perspective-photo, padded composition, native final-resize and deliberately wrong padding-before-perspective rasters. `pipeline-manifest.json` records their dimensions/hashes and the independently computed perspective dimensions. The fixture is synthetic, not a camera-calibration or metric-rectification claim.
