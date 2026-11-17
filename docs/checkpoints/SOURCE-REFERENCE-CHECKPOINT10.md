# Development source checkpoint 10, 2026-10-22

This is a source-only increment after the delivered 0.2.2 development installer. It adds session-only frozen-reference comparison. Package/app version remains 0.2.2 pending a later coherent release; the saved 0.2.2 Setup programs do **not** contain this increment. Stable 0.1.1 identities are untouched. This is not full PixelCake/Xingtu parity or accepted SOTA portrait retouch.

## Frozen reference and current photograph

A completed ordinary framed preview can be explicitly fixed as the left reference. The right side continues editing or displaying another current photograph. Both panes share normalized center and fit-relative zoom, preserving their own aspect ratios; this is not face registration or original-resolution 1:1 inspection. Fit resets both. Space holds the framed original only on the right. Replacing and clearing the sole reference are explicit.

Capture binds immutable source identity, full bounded pixel recipe, actual accepted canvas, render generation, view token and dimensions. Pending, failed, stale, wrong-photo, source-inspection, crop-draft, manual, diagnostic, held-original and old wipe views cannot authorize capture. A failed replacement retains the previous bitmap. Normal processing is not disabled when a recipe is too large for reference provenance.

The actual preview decoder caps the longest edge at1280. A reference has at most6.25MiB raw RGBA; replacement temporarily retains old+candidate, at most12.5MiB excluding metadata/browser overhead. No second original, model invocation or full-size image decode is introduced. Navigation uses the already accepted right canvas and one independent left copy.

Reference state never enters photo recipes, undo/redo, review metadata, dirty fingerprints, project documents, presets or export queues. Photo switches/import/filter/save/export retain it. Removing its source photo or successfully committing a replacement project clears it. Cancelled/failed/rolled-back project replacement preserves it. Actual cancellation/failure tests allow queued rendering to be consumed during busy work and then verify automatic fresh-preview recovery, without manually rescuing the render.

## Verification

Final logs, exact test counts and source hashes are recorded in checkpoints/reference-compare-*. Native-raster synthetic evidence and independent review are in quality/reference-compare-qa; workflow is documented in docs/REFERENCE-COMPARE-DESKTOP.md. UI tests execute the production handlers with authored DOM/Canvas/IPC doubles. They do not validate physical mouse interaction, Chromium layout, Electron or Windows.

Visual inspection found that the installed optional native Canvas test library could return an all-transparent PNG and transparent second-canvas replay after a specific pre-encode/copy/repaint sequence even though the frozen canvas's own getImageData remained correct. This discrepancy is retained, not hidden: independent-native-serialization.json describes its isolated reproduction. Correct visual evidence is encoded from the actual native readback bytes through existing Sharp and decoded back for verification. Production reference capture does not PNG-encode either canvas, and the normal non-preencoded native path is verified separately. The native conditional discrepancy is not resolved by readback alone. Browser/Windows copy/display behavior remains untested.

No new dependency, browser/socket retry, model, API, private-photo upload, fee, credential, publication or user-computer action occurred. No new Setup was built. Coverage W02/T02 is partial; all103 full_acceptance_passed flags remain false. The preceding saved application/source checkpoint is retained at docs/checkpoints/SOURCE-REVIEW-CHECKPOINT9.md, including0.2.2 installer restrictions.

## Retained limits and restore

JPEG/PNG/WebP import and JPEG/PNG export remain8-bit sRGB, noRAW/16-bit/proofing. Basic/local original-size work is limited to64MP/16384-edge; complex portrait/background/manual/selection effects to16MP before crop. Explicit working export4096 is not the interactive1280 preview. No autosave, arbitrary rotation or perspective. Dedicated learned skin/blemish retouch is still unresolved; SegFace is experimental parsing and BiRefNet remains quality-blocked. Classical portrait/manual effects are not SOTA.

Apply this overlay over base Library libfile_409356280a8c8191a5bf3fd3cbdffe91 v1. Dependencies, runtimes, model weights and executables are excluded. CHECKPOINT-FILES.json hashes every included file except itself. Historical build/package reports refer to their recorded pre-comparison snapshot, not the current source. QA portrait fixtures are private informational evidence and excluded from installed application payloads, not marketing assets or endorsements.
