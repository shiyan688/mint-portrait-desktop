# Independent controlled sharpening QA

CURRENT UNRELEASED CANDIDATE. This is cloud Node QA using the installed NativeCanvas and real production Sharp worker threads. A separately authored VM harness executes the production browser pixel-worker source. It is not browser/Electron GUI, Windows, installer, GPU, phone, accessibility, or model-inference validation.

## Reproduce

From the source root:

- `node --test --test-reporter=tap tests/sharpness-independent.test.cjs`
- `node quality/sharpness-qa/independent-render-evidence.cjs`
- `node quality/sharpness-qa/independent-verify.cjs` runs both, refuses source-hash drift, and binds results to the exact production files.

NativeCanvas is discovered through the pre-existing test-only native bridge. Sharp is the already-installed production dependency. No additional library, network, API, private photograph, model or hidden face inference is used. The Victor reshape scenario uses previously restored QA landmarks, not a new detector run. Baseline images are referenced in place and never overwritten or duplicated wholesale.

## Read the images honestly

- `independent-victor-amounts.png` and `independent-mukai-amounts.png`: actual native PNG readbacks at amount 0/25/50/100, radius 1, threshold 3. The overview is scaled only for display. Eye/skin crops are 1:1 source pixels at identical coordinates.
- `independent-noise-edge-counterexample.png`: original, 100/R1/T3, 100/R3/T0, and 100/R3/T12. Includes a deterministic gray-noise negative control displayed at nearest-neighbor 3x, 1:1 Mukai skin/eye crops, and a softened edge.
- `independent-pixels.json`: native PNG/RGBA hashes, recipe parameters, source references, per-region numerical changes, actual local-luminance bound checks and counterexample measurements. PNG hashes for images not saved individually bind the reproducible in-memory native output, not a promise of extra downloadable files.

Observed result: R1/T3 is intentionally very restrained on these portraits, even at amount 100. At 1:1 there is no obvious bright edge fringe, flattened skin, geometry change or invented texture. This is not a perceptual-quality benchmark, a claim of conspicuous sharpness improvement, or recovery of detail. Victor's amount-100 eye/skin mean absolute RGB changes are about 0.023/0.063 of one byte code; Mukai's are about 0.069/0.037. A changed-channel count is only a diagnostic, not evidence that an image looks better.

The aggressive setting visibly strengthens grain. Seeded noise scalar-luminance variance rises from 13.858 to 17.673 at 100/R3/T0 (about 27.5%); R3/T12 leaves that noise exactly unchanged. Softened-edge contrast at the fixed two sample positions rises from 59 to 65 codes with no local-luminance-extremum violation. This demonstrates a trade-off, not denoising or restoration. The default amount remains zero.

Radius is standard deviation relative to a 1000-pixel input short edge. A separately rendered preview is approximate: resizing, quantization and the fixed 3x3 halo limiter do not commute. The independent preview negative control deliberately establishes that matching radius semantics do not imply exact resolution covariance.

## What is actually checked

Twenty independent tests cover the exact shared core hash and defaults; strict finite recipes and native typed storage; identity at null/zero; an independent direct-tap fractional convolution oracle; original bytes, alpha and zero-alpha hidden-color retention; visible-neighbor independence from hidden RGB; true 3x3 visible linear-luminance bounds with a half-byte RGB quantization envelope; saturated colors and zero-channel preservation; flat skin/crisp-step identity; noise and softened-edge controls; memory/dimension limits; cancellation through final publication; exact neutral native PNG and metadata compatibility; actual source-pixel Worker PNG parity; production web-worker/native parity through tone/local effects/reshape; and an independently assembled geometry/compositing/resize pipeline.

The full stage test explicitly compares against photo effects → source-space sharpening → framing → exact 90-degree straighten → padding → actual NativeCanvas text → actual paint → redaction → final Sharp Lanczos resize. Wrong early sharpening and wrong post-overlay sharpening are observably different negative controls. Exact-turn geometry and independent source-over/redaction oracles are reused from established independent QA helpers, rather than calling the production geometry/compositor in the expected path. The current test is not a new arbitrary-angle interpolation certification.

Active sharpening validates the selected processing source before crop or final output resizing: at most 16,777,216 pixels and 16,384 per edge. Explicit working-size export may deliberately reduce a larger valid original first; that is not a silent cap bypass. Original mode cannot hide an oversized sharpening source behind a small crop/final size. The managed 512 MiB preflight includes source/edited planes, sharpening scratch, geometry, overlays and retained backing storage. These tests establish preflight arithmetic and rejection, not that peak operating-system resident memory is guaranteed below 512 MiB; codec/VM overhead is outside that model. Null/zero keeps the previous 64MP source limit.

Forged enabled/recipe/algorithm metadata is rejected by the native renderer. Native cancellation terminates the active worker, leaves original encoded bytes intact, and permits a subsequent export. No package or installer was built or released by this independent audit.

## Source provenance and restrictions

The actual restored Victor, Sunita Williams and Chiaki Mukai pixels were visually inspected before the first sharpening run. Existing baseline files and provenance are referenced, not recopied:

- Victor Glover, NASA/Bill Ingalls: `quality/fixtures/victor.png`, [NASA NHQ202009150002](https://images.nasa.gov/details/NHQ202009150002). Baseline attribution in `quality/fixtures/manifest.json`.
- Sunita Williams, NASA/Mark Sowa: `quality/fixtures/suni.png`, [NASA jsc2005e02663](https://images.nasa.gov/details/jsc2005e02663). Additional full-image native/core parity and halo safety, not a separate rendered sheet.
- Chiaki Mukai, NASA: `quality/manual-tools-qa/fixtures/05_mukai.rgba.gz`, dimensions/crop in the adjacent JSON and restrictions in `PROVENANCE.json`; [NASA metadata S97-00568](https://images-assets.nasa.gov/image/S97-00568/metadata.json).

These are private, noncommercial, informational software-QA comparisons only. NASA-origin copyright status is not a model release or blanket commercial permission. Preserve photographer/agency attribution, identify edits as software test output, and do not imply NASA, JAXA, NASDA or subject endorsement. No commercial, marketing, public product-demo, app-sample, training or dataset redistribution clearance is established. Existing [NASA image/media usage guidance](https://www.nasa.gov/nasa-brand-center/images-and-media/) and the stricter restored fixture provenance govern. Sources were not fetched or re-licensed during this audit.
