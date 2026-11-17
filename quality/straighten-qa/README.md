# Desktop straighten independent QA

**CURRENT CANDIDATE CODE / 未发布候选.** This evidence does not describe the frozen 0.2.6 release. No installer or release archive was rebuilt or changed.

## Result

The independent suite currently passes **17 tests, 0 failures, 0 skips**. The saved terminal result is `independent-test-results.txt`. The suite was rerun after the UI adopted production `Pipeline.preflightRender`, retained the processed comparison Canvas in its budget, and corrected retained overlay accounting to `raster.rgba` with shared-backing deduplication. The manifest separates image-generation hashes from the latest validated source hashes; UI-only admission changes did not require regenerating the PNGs. The final source snapshot is recorded after the default capture-if-present brush fix and a fresh 17/17 independent pass. The separately owned full aggregate gate was also verified at 2,662/2,662, with no failures, cancellations or skips.

One admission defect with two manifestations was found and fixed by the integration owner: explicit identity framing and explicit zero-edge padding still allocate RGBA, but the first active-straighten memory envelope omitted those allocations. The geometry envelope now charges non-null framing/padding and a separate retained edited-source plane. The independent regression proves that the null-stage case is admissible while either allocated neutral stage crosses the 512 MiB limit, without allocating a large raster. Browser preflight is also checked with metadata-only surfaces whose readback/worker allocation would throw.

No additional pixel defect was found in the inspected synthetic/NASA cases. This is bounded QA, not proof for all images or environments.

## Reproduce

From the source root, using the already installed NativeCanvas and Sharp:

```sh
node --test tests/straighten-workflow-independent.test.cjs
node quality/straighten-qa/independent-evidence.cjs
```

Neither command downloads models/assets or installs dependencies. Native prerequisites are mandatory; missing NativeCanvas/Sharp is a failure, not a skip.

## Independent coverage

- `independent-oracles.cjs` computes quantized crop, all old turn/flip combinations, padding, exact turns, inverse sampling, sRGB transfer, premultiplied-alpha composition and hard cover without calling the corresponding production geometry/straighten/padding/compositor/redaction planners or rasterizers. Crop dimensions use a numerical continuous-area optimization, not the production closed-form solver. Ordinary-angle comparisons allow at most 1 byte of difference.
- 48 arbitrary geometry cases cover four odd/even/thin source shapes, six signed angles and both modes. 64 exact-turn cases include independent nontrivial crop and every old turn/flip state; source bytes including hidden RGB are unchanged.
- 48 selected-paint combinations check scalar Float32 mask coordinates through independent crop/flip/turn/padding. Another 48 combinations observe the real production exact-turn transport and compare its complete packed Float32 bytes with the scalar oracle. The observation wrapper delegates unchanged to the real core.
- Selected paint/redaction, including saved hidden and empty layers, rejects arbitrary angles before Canvas allocation. No collection is rewritten.
- The default checked “capture selection, if present” UI still permits unselected painting, solid cover and mosaic on a +13° canvas. With an existing selection, all three reject +13° without altering settings, selection, history or accepted pixels, and accept exact 90° with one history entry. These nine real event/pixel cases guard the default-brush regression; no selection is invented or silently deleted.
- Negative controls deliberately use gamma-space interpolation, non-premultiplied color, the wrong angle sign, paint after cover, raw-original stretching, an edited original comparison and a second rotation. They must differ meaningfully, so an identity or visually plausible wrong result cannot pass by accident.
- Native PNG uses real source-local edits, accepted framing, arbitrary straighten, asymmetric padding, real NativeCanvas text and paint, final opaque cover, then explicit Sharp Lanczos resize. A separately assembled result agrees within 1 byte. Real positive/negative-angle exports have equal dimensions but distinct pixels and complete recipe/algorithm metadata.
- Hidden transparent RGB cannot tint arbitrary interpolation; PNG export sanitizes zero-alpha RGB. Exact-turn pure replay preserves bytes while export sanitation remains explicit. Input PNG bytes and the existing NASA source remain unchanged.
- Actual current `app.js` runs in an authored DOM/IPC shell with installed NativeCanvas. Independent pixels verify accepted geometry on the neutral original comparison; a deliberately delayed neutral-original result cannot replace a newer, same-size opposite-angle result.
- Core provenance is checked against frozen mobile SHA-256 `7b28d67aba28747e85abf95c12b39522153871c4d084038bcb053244fa11f98e`.

## Inspect the PNG evidence

All four contact sheets were opened and visually inspected at generation time. Original-size PNG outputs are retained beside them, rather than only providing display-resized panels.

1. `independent-grid-contact-sheet.png`: asymmetric labeled grid, alpha ramp, clockwise expand, centered crop and exact 90°. Transparent corners are visible and the alpha ramp has no hidden-green fringe.
2. `independent-nasa-contact-sheet.png`: the one existing public NASA portrait fixture, original / +13° expand / +13° crop / exact 90°. The crop intentionally removes peripheral content. No unexpectedly stretched face, wrong orientation or opaque corners were observed.
3. `independent-order-contact-sheet.png`: source edits and geometry, full final composition, explicit 160-pixel export, and a deliberately incorrect paint-after-cover control. The correct text/paint remain aligned to the final canvas; the red cover remains above magenta paint. The negative control visibly violates that ordering.
4. `independent-phase-contact-sheet.png`: nearest-neighbor display of the 16×12 checkerboard, `1e-20°` result and exact 90°. The tiny nonzero angle expands to 17×13, introducing a half-pixel phase; the interior is sRGB 188, not an unchanged checkerboard. This is the frozen algorithm's disclosed behavior, not a lossless claim or an epsilon-snapping fix.

`independent-manifest.json` records every output PNG/RGBA hash, dimensions, algorithm metadata, tested source hashes, NASA provenance and original-byte invariance. The six grid/NASA oracle comparisons and the full order comparison currently have **0 maximum byte error**. The wrong-order control differs in **4,320 channels** for the evidence fixture.

## Public fixture provenance

Only `quality/fixtures/victor.png` was used as the real-person fixture. It is the existing cropped/resized QA derivative of NASA/Bill Ingalls photograph **NHQ202009150002**, recorded in `quality/fixtures/manifest.json` and `victor.json`.

- Source page: https://images.nasa.gov/details/NHQ202009150002
- Existing PNG SHA-256: `790bf7eee26069ce2a9222af8cebcf8782fc801beedf52ef46f2b3169f07cffe`
- Existing RGBA SHA-256: `bd1e2d71d7c17fdc1e450c7f9ee73ec713b3b7c10d20fe5472af7962ebdd59bd`

Use is factual, noncommercial software-testing illustration only. Edited comparisons are software outputs, not NASA-provided images, and imply no endorsement. Do not copy this fixture/evidence into app assets, promotional material or marketing.

## Limits

This is cloud Node/VM, actual NativeCanvas and Sharp evidence, not actual browser layout, Electron, Windows, installer, GPU/4060, device latency or RSS validation. The 512 MiB envelope is managed geometry admission, not a total process/native/GPU memory guarantee. Preview and full export can differ through separately documented sampling/rounding. Exact-turn byte preservation belongs to the pure core, not Canvas readback, JPEG or re-encoding. This file reports the independent suite only; the root owner separately owns full `npm test` and the overall release gate.
