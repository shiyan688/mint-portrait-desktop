# Development source checkpoint 8, 2026-10-22

This unreleased overlay includes the completed desktop geometry and portable named-adjustment preset milestones. No new installer has been built for either. Package/installer version metadata and existing payload validation reports still refer to older 0.2.1 binaries, not this changed source. Stable 0.1.1 remains untouched. Previous checkpoint7 is preserved in docs/checkpoints/SOURCE-GEOMETRY-CHECKPOINT7.md.

## Named portable presets

The desktop now has a compact staged library with explicit capture/name/new/update/import/export, recoverable removal/restore, and confirmed backup recovery. Only whitelisted basic tone, portrait numeric controls/palette and advanced curves/HSL enter the version1 .mintpreset.json format. It does not automatically copy photos, file paths, IDs, landmarks, geometry, masks, strokes, shape controls or projects. Import stages a recipe and never silently edits a photo. The local library supports100 active and20 recoverably removed presets; malformed data fails closed instead of resetting the catalog.

Current/selected/all targets and full/color-only modes are explicit. Full nonneutral portrait application separately decodes and analyzes every target's own source. All changes commit synchronously only after successful preflight and frozen source/revision/history validation. Cancellation, a missing mesh or a stale target commits none. Color-only preserves each existing portrait setting. Every changed target gets one independent undo entry; existing geometry, manual edits, masks, source bytes and cached analysis are not copied from a different photograph.

Host persistence accepts documents and opaqueIDs, never renderer-supplied paths. Native dialogs authorize preset file locations. Strict bounded UTF8 reads, duplicate-aware parsing, capacity limits, same-directory temporary writes/fsync/atomic rename, no-clobber linking for new files, preserved corrupt originals during backup recovery, and error/warning propagation were tested with actual temporary files and injected failures. There is no cross-process compare-and-swap or crash/power-loss guarantee. Directory refresh warnings are shown instead of claiming durable success.

## Evidence

The frozen complete suite passes1009/1009 with zero failures or skips. New UI tests61/61 use authored DOM/Canvas/IPC doubles, not a real browser. Independent safety36/36 and combined focused85/85 pass. Deliberate unsafe mutations of bounded reads, empty-catalog validation, decoded duplicate-key checks and Unicode truncation fail their matching regressions. The pre-existing fast-photo-switch race test exposed a too-broad lock and was repaired without weakening that test.

quality/presets/portrait-portable-preset-contact.jpg was generated from actual approved public-fixture pixels and visually inspected. Neutral settings preserve every pixel; saving/importing the recipe preserves the processed pixels; actual native PNG export matches the shared RGBA output and preserves the original. Two recipes, including active portrait+basic+curves/HSL together, match Android's actual new preset operation byte-for-byte on the same897×1000 adult portrait and478-point supplied mesh. These are recipe replay tests, not generalized appearance equivalence, learned-retouch quality certification, app screenshots, marketing art or endorsement. No model ran for this milestone.

Shared portable files are interoperable, not desktop/mobile project histories. Mobile operations stack in ordered history; desktop parameters replace the three explicit groups. Different photos, decoded pixels, landmarks or engine versions can legitimately yield different appearances. All QA people remain private informational samples and are excluded from application packaging.

## Geometry and retained limits

Final integer crop/quarter-turn/flip follows original-space edits and preserves their coordinates, histories, masks and original source. Project schema5 reads versions1–4. Pixel scales, actual encoded output dimensions and native-worker response metadata are verified. General64MP/16384-edge and complex16MP budgets apply before crop; working-size reduction remains an explicit choice. Existing transparency/liquify and stale-geometry guards remain intact. See docs/GEOMETRY-DESKTOP.md and checkpoint7 for its869-test evidence.

This is not full103-work-package acceptance or the promised SOTA portrait remake. Dedicated learned blemish/retouch remains unresolved; SegFace/BiRefNet quality/provenance restrictions are unchanged. No native Windows install/launch/uninstall,4060 performance, actual Chromium visual inspection, signed app, API invocation or private-photo upload occurred. Browser socket restrictions were not bypassed. RAW/16bit, perspective, arbitrary-angle rotation and autosave are not added.

## Restore and continuation

Apply this curated overlay over base Library libfile_409356280a8c8191a5bf3fd3cbdffe91 v1. Dependencies/runtime/model weights/executables are excluded. CHECKPOINT-FILES.json hashes every included file except itself; historical installer/test reports apply only to their recorded snapshots. The next bounded desktop module is ratings/flags/color labels and safe filtered batch scope; it is not present as a working feature in this checkpoint.
