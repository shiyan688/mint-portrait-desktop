# Natural-skin mitigation baseline (2026-10-21)

## Status and scope

This is a targeted repair for the reported pale facial polygon and sharp eye/brow cutouts. It is **not a SOTA retouching implementation, not a learned beauty model, and not completion of the requested SOTA remake**. Release packaging is paused pending the broader algorithm review. No model, API, photo-upload service, paid dependency, or signing/publication step was added.

Frozen core: `src/portrait-engine.cjs`

- Repaired SHA-256: `65cebaaaf65797e9661ee213d28083eec4c4f194fc14384ebd8ec8340cc00b2c`
- Previous SHA-256: `28cea8141d7187db124097f2545b9749ab3cd6d8dfabe81c2a1c8c5db82e6532`
- Previous core retained as `quality/portrait-engine-baseline.cjs` for negative controls.

## Root cause

The old automatic skin mask rasterized a face polygon and expanded feature holes, blurred that binary mask by only a few pixels, then used `min(binary, blurred)`. This discarded the outward half of every feather and left abrupt transitions at the original polygon and holes. Brightening mixed up to 18% white into sRGB channels, raising black to 46/255 and reducing skin chroma. Smoothing and warmth used the same faulty mask. Applying beauty repeatedly to overlapping detected faces compounded the changes.

## Repair

1. Face outline and feature exclusions receive separate inward distance transforms. Cubic smoothstep ramps reach zero continuously at boundaries. Face-edge feather is 11% of detected face width; feature feather is 6.5%. Eyes, brows and lips remain excluded at their centers without a hard transition around them.
2. Broad, continuous warm-chroma confidence and relative shadow protection reduce edits to hair, non-skin objects and deep occlusions inside the face mesh. An illumination median is sampled from eligible face pixels; this is not a target complexion or a skin-lightening reference. Full-resolution color confidence additionally protects fine non-skin details when the working mask is upsampled.
3. Brightening converts sRGB to linear RGB and multiplies all three channels by the same gain. At full coverage:

   `gain = 1 + 0.32 * slider * shadowGate(Y) * highlightRollOff(max(R,G,B))`

   The maximum theoretical gain is 1.32, approximately 0.40 EV. Shadow gating ramps between linear luminance 0.004 and 0.025. Highlight protection ramps between peak linear channel 0.35 and 0.98. The shared gain preserves linear RGB chromaticity rather than whitening/desaturating skin. LUTs avoid per-pixel power functions.
4. Smoothing low-passes only mask-weighted eligible samples, so eyes/lips/hair do not contaminate the filter. A local color-difference gate preserves significant edges. At slider 100 the blending factor is capped at 0.66 before spatial/range attenuation, retaining part of the original texture.
5. Warmth uses bounded red/blue gains in linear light, renormalizes luminance, protects highlights and compresses only out-of-gamut chroma. It no longer adds red to black or changes exposure by an arbitrary channel offset.
6. Multiple face masks are combined with `max` against the same source image. Beauty is applied once per pixel, preventing overlapping or duplicated detections from accumulating brightness. The worker must pass all face meshes in one beauty call.

## API and invariants

The frozen UMD/CommonJS API remains exactly five operations: `beauty`, `heal`, `reshape`, `warp`, `background`. All return `{ width, height, data }`, preserve dimensions, and do not mutate their input. Beauty preserves every source alpha byte and RGB bytes of fully transparent pixels.

`beauty(image, settings, landmarks)` accepts:

- The original single 468/478-point MediaPipe mesh, with object points or coordinate pairs.
- An optional array of up to five valid meshes, combined before processing.
- No usable mesh only when `settings.region = { x, y, r }` is explicitly supplied. This feathered brush preserves its prior semantics, including deliberate edits to cool/non-skin colors; automatic face color gating is not imposed on the brush.

Zero controls, or no valid face and no explicit region, return a byte-identical independent copy. Smooth/brighten remain 0–100 and warmth remains −100–100. Out-of-range numeric controls clamp; non-finite/non-number controls default to zero. Internal working images remain capped at a 1024-pixel long edge; full-size output supports at most 16,777,216 pixels.

## Regression evidence

Run `node --test tests/audit-engine.test.cjs tests/beauty-natural.test.cjs`: **44/44 passed** on the repaired core.

Run `MINT_ENGINE_UNDER_TEST=../quality/portrait-engine-baseline.cjs node --test tests/beauty-natural.test.cjs`: the original fails **8 of the 10 new tests**. Two shared API/input invariants pass on both. These tests are synthetic error-isolation measurements, not model-accuracy or perceptual-quality benchmarks.

Measured failures caught by the new tests:

- Uniform-skin adjacent mask step: original 15 RGB levels; repaired at most 3 at the tested resolution.
- Dark-skin linear chromaticity drift: original 0.129; repaired below 0.012 across seven synthetic skin palettes.
- Original black was lifted from 0 to 46 at max brightness; repaired black/deep shadows and specular highlights stay within two levels in the test cases.
- Original dark hair `[18,16,14]` became `[79,61,39]` with all controls maxed; repaired protected patch changes by at most one level.
- Monotonic usable slider range, warmth luminance retention, duplicate/order-invariant mask unions, alpha/input preservation and one-pixel black/blue occluders at 1301×1511 are covered.
- The existing cheek-noise regression measures variance 43.27 → 12.84 at smoothing 90, while feature centers and strong edges remain protected.

A synthetic 4096×4096 image with one genuine MediaPipe mesh took 1.307 seconds for brighten 100 and 1.633 seconds for all three controls at 100 on the build container. Observed process RSS was 194/224 MiB. This is a CPU/container observation, not an RTX 4060, Windows or Android performance claim. Independent real-photo renders and their exact hashes belong in the separate `quality/` report.

## Remaining handcrafted algorithms and replacement seams

- **Skin retouch:** all masking, smoothing, tonal lift and warmth above remain handcrafted. Replace the internal skin-confidence producer with a validated local face-parsing/skin-mask provider, and the smoothing/blemish stage with a separately evaluated local retouch/restore provider. Keep the existing image/settings boundary, alpha/no-op rules and one-pass mask union. An asynchronous model provider should be orchestrated in the worker, not hidden behind a synchronous core API.
- **Healing (`heal`):** deterministic ring sampling plus a least-squares local color plane and feathered blend. It is not texture synthesis, inpainting or semantic blemish removal. A replacement can consume source RGBA plus the existing spot circles converted to an edit mask, and return edited RGBA under the same source-preservation contract.
- **Reshape (`reshape`):** landmark-anchored elliptical displacement fields for slim/eyes/nose/jaw, bounded displacement and inverse bilinear resampling. It is not 3D-aware learned face reconstruction. A future geometry provider should produce one composable displacement field, with identity/occlusion/fold-over checks and shared application to foreground/background.
- **Brush warp (`warp`):** radial polynomial falloff with a displacement cap and premultiplied-alpha bilinear sampling. This is a deterministic editing tool, not an AI model. Its sampling boundary is separable from any future flow-field provider.
- **Background (`background`):** supplied confidence matte, bilinear resampling, outward feather, normalized box blur and alpha/color compositing. It does not infer a subject itself. Its existing `{ width, height, data, maxValue? }` mask input is a clean adapter for a better locally evaluated matting provider; soft hair boundaries need separate real-image acceptance tests.
- **Global tone (`tone` in `pixel-worker.js`, unchanged here):** fixed exposure/contrast/saturation/temperature math. Basic color transforms should remain deterministic and color-correct; an optional learned color/style provider should be separate and identifiable, not relabel these equations as SOTA.
- **Detection / segmentation (`pipeline.js`, unchanged here):** detector output already enters as normalized meshes and a confidence matte. Model selection, inference backend, license compatibility, memory budget, offline distribution and comparative quality gates require a separate review before replacement.

## Limitations

The color confidence is a heuristic, not semantic skin segmentation. Unusual illumination, makeup, very desaturated skin, occlusions, facial hair, poorly detected/profile faces, saturated channels and skin-colored objects can still be misclassified. The automatic face oval does not cover the entire scalp, ears, neck, hands or body. Smoothing is not frequency-separated professional retouching or learned restoration; it cannot recover missing detail. These repairs mitigate specific artifacts without establishing SOTA quality or universal skin-tone robustness. Keep the original image and provide conservative controls while the model-backed redesign is evaluated.
