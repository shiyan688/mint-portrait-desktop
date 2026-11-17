# Skin engine real-image defect-mitigation QA

Date: 2026-10-21 UTC. Scope: independent visual and production-worker integration checks, not a SOTA certification or release approval.

## Status and important limits

The old hard pale face polygon, eyebrow/eye cutouts, visible forehead mask boundary, and grey/desaturated skin were reproduced on public real photographs. The repaired skin engine removes those glaring artifacts in the three inspected fixtures. This is a useful defect-mitigation baseline, **not** a finished SOTA portrait system. The user subsequently requested SOTA algorithms; do not describe this evidence as satisfying that request.

Remaining quality limitations observed:

- Maximum smoothing visibly removes substantial fine skin texture. Lower settings are more restrained, but this is a classical spatial filter, not texture-aware learned retouching.
- Maximum negative jaw widening, especially in the combined maximum reshape setting, makes the face outline unnaturally bulbous. No pixel tears, empty regions, or hard interpolation seams were seen, but geometric continuity is not aesthetic quality.
- Warmth ±100 intentionally makes substantial hue changes. No new hard mask plate was seen, but maximum warmth is conspicuously orange and maximum cooling can look dull. These are not recommended natural defaults.
- Skin membership, shadow protection, feathering and smoothing are heuristic. There is no learned skin/hair/occluder semantic segmentation, intrinsic-image decomposition, reconstruction, or physically grounded relighting here.
- Face-only correction does not provide a whole-person skin-tone consistency model for neck, ears, hands and other exposed skin.
- Three portraits are not broad enough to certify all skin tones, phone-camera noise, mixed light, oblique poses, strong occlusion, group portraits or facial hair. No private original photo was available, so this cannot establish restoration of the reported user image.
- These checks ran on a Linux cloud CPU, with actual Python MediaPipe inference and Node execution of the production JavaScript worker. They do not establish native Windows, RTX 4060, Android WebView, browser/WASM detector or display-color-management equivalence.

No unresolved execution blocker remains in this assigned QA. There is a product-quality blocker to calling these algorithms SOTA, and a visible extreme-geometry limitation noted above.

## Exact engine and inference provenance

- Frozen old production engine SHA-256: `28cea8141d7187db124097f2545b9749ab3cd6d8dfabe81c2a1c8c5db82e6532`.
- Repaired final engine SHA-256: `65cebaaaf65797e9661ee213d28083eec4c4f194fc14384ebd8ec8340cc00b2c`.
- Actual `mediapipe==0.10.21` Python Tasks FaceLandmarker ran locally with the bundled `assets/models/face_landmarker.task`, CPU/XNNPACK delegate, image mode, detection/presence confidence 0.5.
- All three fixtures yielded 478 actual landmarks. The exact detector version, model SHA-256, image SHA-256 and coordinates are saved in each `quality/fixtures/*.landmarks.json`. No landmark was invented or manually corrected.
- Latest Python MediaPipe 1.1.1 could not initialize in this container because of a tcmalloc CPU-count failure. The working 0.10.21 runtime used the same shipped task-model asset. This is explicitly not a claim that Python and the app's web runtime produce byte-identical landmarks.
- Missing GLES runtime was supplied only to this local test process by extracting the official Debian `libgles2_1.7.0-1+b2_amd64.deb`. Its SHA-256 was verified as `e12c18aa77939d122ee1dea520ba0440b97dc19200b7396e03dff03a3ece74c1`. No system library was installed or altered.

## Real public fixtures and permitted use

Primary-source provenance was checked before processing, using NASA's Image API records and current NASA Images and Media Usage Guidelines. Each source is NASA-owned rather than an image merely hosted by NASA with a third-party credit. NASA allows factual educational/informational use subject to its guidelines. These are **non-promotional software-test illustrations**, not licensed commercial likenesses, promotional product assets, endorsements, or training data.

- Victor Glover, `NHQ202009150002`, NASA/Bill Ingalls, 2020-09-15. Darker skin appearance, directional light and shadows, environmental background. [NASA record](https://images.nasa.gov/details/NHQ202009150002), [primary API](https://images-api.nasa.gov/search?nasa_id=NHQ202009150002).
- Suni Williams, `jsc2005e02663`, NASA/Mark Sowa, 2004-09-22. Medium skin appearance, studio illumination, dark hair crossing face edge. [NASA record](https://images.nasa.gov/details/jsc2005e02663), [primary API](https://images-api.nasa.gov/search?nasa_id=jsc2005e02663).
- Eileen Collins, `KSC-99pp0310`, NASA, 1999-01-04 record date. Lighter skin appearance, bright studio light, bangs and fine hair at forehead. [NASA record](https://images.nasa.gov/details/KSC-99pp0310), [primary API](https://images-api.nasa.gov/search?nasa_id=KSC-99pp0310).
- [NASA usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/), checked 2026-10-21. Preserve source attribution and no-endorsement notice. Do not use people or NASA insignia to market the product.

The source-file URL, hash, photographer, metadata and permitted-use note are in `quality/fixtures/manifest.json`. Original downloads were cropped consistently and downsampled with Lanczos to a 900-pixel long edge. Crop coordinates and RGBA hash are retained in the per-fixture JSON. No retouching was applied before the baseline/candidate processing. Descriptions of visible skin appearance above describe test coverage, not demographic inference.

The user's screenshot was inspected locally only. Any locally retained crop is an **already-processed diagnostic, not the original photo, not evidence of restoration**. It is excluded from public sheets, source packages, app payloads, Library attachments and external requests.

## Render matrix and independent inspection

For each real RGBA fixture, both old and repaired engines were run at:

- unchanged settings;
- brighten 25, 50 and 100;
- smooth 50 and 100;
- smooth + brighten 50/50 and 100/100;
- smooth100 + brighten100 + warmth100 and warmth−100.

For the final repaired engine, additional real-image geometry checks used slim100, eyes100, nose±100, jaw±100, all-positive maximum reshape, and mixed maximum reshape with negative nose/jaw.

The reviewer opened the actual rendered image pixels rather than relying on byte-count changes or synthetic tests. Inspection included all three six-panel skin sheets, old/new comparisons, native-resolution eye/brow/forehead/hairline crops, lip/jaw crops, warmth extreme sheets and native-resolution warmth face crops, and all three reshape extreme sheets. The old rendering clearly reproduced the failure. The final skin rendering showed progressive +25/+50/+100 luminance lift with no obvious new pale plate, hard eye/brow cutout, facial outline seam, white halo or painted-over hair. Lips and eyes remained recognizable and did not brighten as skin cores.

Public review artifacts, kept outside shipping app/source packages:

- `quality/comparisons/final/public-before-old-new-zh.jpg`: concise Chinese-labeled original / old+100 / repaired+100 comparison, 593,106 bytes; includes NASA credit and no-endorsement notice.
- `quality/comparisons/final/{victor,suni,eileen}-contact-sheet.jpg`: original, +25, +50, +100, smooth100 and combined100.
- `quality/comparisons/final/*-forehead-eyes-native.jpg` and `*-lips-jaw-native.jpg`: native test-resolution details.
- `quality/comparisons/final/*-warmth-extremes.jpg` and `*-reshape-extremes.jpg`: adverse setting inspection, not recommended presets.
- Individual PNG outputs, exact settings, timings and engine hash are retained in the same directory.

## Supplemental independent pixel diagnostics

The quantitative checks supplement the above visual review. They measure the *edit delta*, not original image edges. Boundary strips cover face-oval and eye/lip/brow polygon edges from actual landmarks.

| Fixture | Old boundary edit-gradient p95 / max | Final p95 / max | Final protected-feature core max change | Final face-core mean luminance lift |
|---|---:|---:|---:|---:|
| Victor | 20 / 28 | 1 / 1 | 0 | 10.104 |
| Suni | 21 / 29 | 1 / 2 | 0 | 11.041 |
| Eileen | 19 / 29 | 1 / 2 | 0 | 8.622 |

Units are 8-bit RGB channel differences for gradients/core change; luminance uses sRGB-weighted channel values for a descriptive diagnostic, not a physical radiometric metric. Core masks exclude boundary pixels. At +100, old face-core channel spread was about 0.821× the original, indicating desaturation; final ratios were 1.052–1.084×. This channel-spread diagnostic is not a claim of exact perceptual hue invariance. See `quality/comparisons/final/pixel-diagnostics.json` and `quality/measure_quality.py` for definitions.

## Production desktop worker integration

`quality/worker-parity.test.cjs` runs the actual current `src/pixel-worker.js` source in a Node VM with the current production engine and the exact real RGBA fixtures/landmarks.

21/21 checks passed:

- all three fixtures at brightness 0/25/50/100 and smooth100+brighten100 are byte-identical between the production worker path and direct engine output;
- duplicate real meshes do not compound beauty processing;
- no detected mesh leaves skin operations exactly unchanged.

The worker-source hash, engine hash and per-case results are in `quality/comparisons/final/worker-parity.json`; TAP output is retained beside it. This covers worker composition and union behavior, not native Windows/browser transport, actual detector WASM, GPU behavior or UI rendering.

## Reproduction

Run from the project root. The fixture files may be kept private to the local QA workspace, and must not be silently added to product assets.

1. `python quality/fetch_fixtures.py` obtains only the cited public images and records exact provenance.
2. `python quality/prepare_fixtures.py` performs documented crops/downsamples and exports RGBA.
3. Install `mediapipe==0.10.21` into an isolated local Python target/environment. Run `quality/detect_faces.py` with the local target on PYTHONPATH and a supported GLES runtime available. No network inference is used.
4. `node quality/render.cjs quality/baseline-portrait-engine.cjs baseline`; `python quality/make_sheets.py baseline`.
5. `node quality/render.cjs src/portrait-engine.cjs final`; `python quality/make_sheets.py final`; `python quality/measure_quality.py final`.
6. `node quality/render_extremes.cjs src/portrait-engine.cjs final`; `python quality/make_extreme_sheets.py final`.
7. `node --test quality/worker-parity.test.cjs`.
8. Open and independently inspect the generated PNG/JPEG pixels at meaningful face magnification. Do not replace that step with counts or a unit-test pass.

All of `quality/`, including temporary dependencies and private diagnostics, remains excluded from the packaged application and source deliverable. A selected public factual comparison may be delivered separately after review, with attribution and these limitations.
