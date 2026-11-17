# Development source checkpoint 7, 2026-10-22

This unreleased source adds coherent non-destructive framing on top of the separately delivered 0.2.1 development patch. No new installer was built for this checkpoint. Package/installer version metadata and payload validation reports still describe the older 0.2.1 binaries, not this changed source. Stable 0.1.1 files remain untouched. The preceding tone/manual checkpoint is preserved in docs/checkpoints/SOURCE-0.2.1-CHECKPOINT6.md.

## Completed geometry milestone

The desktop now has a collapsed crop/rotation panel, drag or exact-original-pixel numeric crop drafts, explicit Apply/Cancel, clockwise/counterclockwise quarter turns, horizontal/vertical flips, and framing-only reset. Changes are ordinary undoable settings. Drafts cannot leak into saved projects, batch settings or exports. The original/edited comparison uses identical final framing rather than stretching an uncropped original.

The shared geometry core copies pixels exactly after all original-space editing. Source bytes, source revision, learned caches, matte corrections, local masks, manual strokes and repair donors are not cropped, re-bound or deleted. Manual/diagnostic editing visibly returns to the full source coordinate system. Legacy point healing also suppresses temporary automatic geometry/background and refuses new points after manual liquify, without invalidating earlier legitimate spot-then-liquify records. This prevents editing against displaced coordinates.

Project schema 5 preserves framing in current/committed/undo/redo/exported snapshots, reads versions 1–4, and retains large valid archived originals even when rendering is over budget. Oversized originals disable unavailable original-coordinate framing controls explicitly instead of crashing project restoration. Desktop final-framing projects are not interchangeable with mobile ordered-operation projects; only geometry math is shared.

## Actual pixel and safety evidence

The complete Node suite passes 869/869 with zero failures/skips. New focused geometry UI checks pass 61/61, using authored DOM/Canvas/IPC doubles plus real core/project logic and one actual native-worker/PNG path, not a browser. Independent geometry/export guards pass 43/43, with a separate 2-D pixel oracle, real PNG/JPEG codecs, cancellation/release and adversarial payload checks. The broader independent non-UI run passes 113/113. Inherited-getter validation and mismatched native-output metadata/encoded dimensions were found and repaired before this checkpoint.

quality/geometry/portrait-geometry-contact.jpg was generated from actual shared-core pixels and inspected: unchanged original, crop, quarter turn and flip. The accompanying native PNG export exactly matches the shared RGBA result and preserves the source hash. This is a private informational public-photo QA sheet, not a UI screenshot, a beauty comparison, licensed commercial app art or an endorsement. Existing public-photo restrictions remain. No QA portraits are part of application packaging.

## Processing/export contract

Working mode resizes the entire source first, then applies final geometry. Original mode keeps original pixel scale before crop. Encoded final dimensions, pre-framing processing dimensions, original dimensions and scaled/framed flags must all match; encoded image headers are inspected as well. Learned masks remain at processing dimensions. General 64 MP / 16384-edge and complex-effect 16 MP limits apply before crop; a tiny crop is not a limit bypass. Transparent RGB privacy sanitization remains export-only. Geometry does not add RAW/16-bit support or arbitrary-angle/perspective correction.

## Remaining boundaries and next work

This is not a completed SOTA retouch remake or full competitor feature acceptance. SegFace/BiRefNet evidence and their known quality limitations remain unchanged, with no new model execution in this milestone. No browser visual QA, native Windows install/launch/uninstall, real pointer-device crop test, GPU/4060 timing or paid API operation occurred. Existing environment restrictions were not bypassed. The next approved module is named portable adjustment presets containing only safe color/portrait controls, with no photos, paths, geometry, masks, landmarks or strokes; it is not included as a working feature in this checkpoint.

## Restore

Apply this curated source overlay over base Library libfile_409356280a8c8191a5bf3fd3cbdffe91 v1. Dependencies/runtime/weights/executables are excluded; follow the existing official dependency instructions. CHECKPOINT-FILES.json hashes every included file except itself. Historical installer reports and earlier test logs keep their original dates and apply to their own recorded snapshots. Current geometry reports and the final 869-test TAP file describe this source milestone. Save projects manually before closing; no autosave claim.
