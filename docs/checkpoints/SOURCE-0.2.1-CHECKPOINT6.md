# Development source checkpoint6, 2026-10-22

This source matches the0.2.1 development patch, not a completed SOTA remake. The actual Windows online/offline Setup artifacts are separately versioned; stable0.1.1 Library identities remain untouched.

## New coherent module

Shared advanced-tone.cjs provides master/RGB five-node monotone or explicitly free curves, eight hue bands, enable/strength, and exact neutral/reset behavior. Circular adjacent hue weights plus smooth saturation/chroma guards avoid amplifying near-black/near-white one-code noise. It is conventional8bit gamma-sRGB color control, not learned retouch or an automatic natural-beauty preset. The histogram reads accepted preview pixels, excludes overlays/comparison/checkerboards, weights alpha, rejects stale results, and discloses deterministic sampling. Project schema4 reads1/2/3, preserving originals and manual history. Tone participates in undo, presets, synchronization and original-size native export.

## Safety fixes

Transparent-source manual liquify in actual0.2.0 ASAR preserved the old alpha silhouette and lost102 moved green pixels in an opaque-control synthetic comparison.0.2.1 refuses input alpha below255 in UI/Worker/native rather than flattening or pretending alpha was warped. Opaque images remain supported; transparent-source selection/color/explicit clone remain supported. Shared repair now has normalized conservative8%bounding/4%swept-area limits, avoiding a tiny-preview acceptance that later failed during original-size export. Old oversized strokes fail explicitly; no source or history is silently discarded. The earlier stale-matte/automatic-geometry guards remain.

The older bundled NASA demo image and import button were removed from application payload. All current QA people/photos stay private informational evidence, not application assets, advertising, training or endorsement. Source restoration may retain historical demo data; do not publicly distribute source photos without clearing rights.

## Evidence

743 complete automated checks pass,0 fail/skip; independent manual+tone suite88 pass. Actual5001×3300PNG output crosses the working4096edge and16MPportrait limits while remaining original-size for global tone, matching core pixels exactly and preserving original encoded/pixel bytes. Real public portrait tone and synthetic boundary comparisons were generated and visually inspected. Source-level DOM tests are not browser screenshots or native pointer tests. Package verifier checks164 application files, explicit QA/demo exclusion, exact ASAR/native libraries and WindowsPE structure. Online/offline installer verification compares embedded payload hashes without executing Windows binaries.

## Remaining boundaries

No accepted dedicated learned skin repair, SOTA/whole-competitor feature completion, RAW/16bit, native Windows installation/launch/uninstall, browser visual acceptance or4060/CUDA measurement is claimed. SegFace/BiRefNet authorized research evaluations remain preserved, but their Python environment/weights are not bundled and matting quality remains blocked. No API invocation, private photo upload, gated-license acceptance, signer creation or publishing occurred. Prior socket/browser restrictions were not bypassed. General original-size8bit export allows64MP/16384edge; portrait/background/manual/selection-layer effects remain16MP. Save projects manually before closing; no autosave.

## Restore

Overlay on base Library libfile_409356280a8c8191a5bf3fd3cbdffe91 v1. Install pinned official dependencies with npm ci --ignore-scripts; build Windows native codec/runtime and installers as documented in installer/BUILD.md. New source ZIP excludes runtime, node_modules, environments, research weights, executables and regenerable full-size tone-output PNGs. Retained contact sheets are visual evidence; pixel assertions use actual raw arrays and metadata, not JPEG comparisons. CHECKPOINT-FILES.json hashes all included files except itself. Historical checkpoint logs keep their original dates/counts. Current developer patch still requires uninstalling an old installation before fresh setup; save open projects first.
