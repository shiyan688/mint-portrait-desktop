# Development source checkpoint 9, 2026-10-22

This curated overlay is the source for the 0.2.2 development bundle: final framing, portable named-adjustment presets and authored photo-review workflow. Stable 0.1.1 identities are untouched; prior development 0.2.1 remains in artifact version history. This is not full PixelCake/Xingtu parity or an accepted SOTA portrait remake.

## Completed photo-review milestone

0–5 stars, pick/reject flags and five color labels have independent bounded undo/redo. Filters/sort do not reorder the original photo array, remove edits or silently deselect hidden photos. Visible-only selection and navigation are explicit; a currently hidden photograph remains identifiable. Keyboard0–5/P/U/X acts only on the current photo, excludes composition/editable inputs and does not advance automatically; F fits the canvas.

Project schema 6 persists every photo's review state/history and reads schemas 1–5 by migrating neutral metadata. Correctly rehashed malformed imports fail before replacing the session. Originals, source revisions, masks, geometry, pixel settings and pixel undo history remain unchanged by review edits. A native Sharp regression confirms encoded PNG and decoded RGBA invariance after 250 metadata/filter operations and an actual project roundtrip.

Batch operations disclose hidden/rejected targets and require explicit confirmation when applicable. Frozen target identity, source Blob/revision, selection and metadata scopes are checked across asynchronous work. Existing frozen pixel recipes remain frozen rather than following later sliders. If scope changes after an actual write, that completed receipt remains a success and later files stop; retry revalidates the exact pending set and cannot duplicate already saved files. No AI culling, EXIF/IPTC editing or dual-photo comparison is claimed.

## Evidence and packaging

The complete direct Node suite passes 1165/1165 with zero failed/skipped/cancelled tests, including 85 new review UI cases and 27 independently authored adversarial cases. The final release rerun follows the 0.2.2 version bump. UI tests use authored DOM/Canvas/IPC doubles, not an actual browser or Windows. The independent review's immutable hashes describe its earlier version-label snapshot; checkpoints/photo-review-release-source-hashes.json records the release tree. Existing preset public-fixture cross-platform pixel parity and geometry PNG evidence remain in checkpoint 8/checkpoint 7 respectively.

The Windows application package was rebuilt using the verified, pinned Electron 45.0.0 ZIP from local storage, without fetching another runtime.169 application files match the source/package manifest. Linux NSIS 3.11 builds real unsigned per-user GUI Setup programs. The installer verifier tests archive integrity, extracts and SHA-256 checks every embedded product file, confirms application/installer version 0.2.2 and PE version metadata/asInvoker/no certificate. Exact binary hashes and actual Library save versions are in the adjacent delivery receipts, not inferred from the version label. Windows install/launch/uninstall and 4060 performance remain untested. No browser/socket restriction was bypassed.

The online Setup embeds the application and downloads only Electron's official 158,223,852-byte runtime ZIP, pinned to SHA-256 ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47. The offline Setup embeds the same curated payload. Save projects and uninstall the old program before installing; there is no automatic in-place upgrade or migration of open unsaved work. Original photos, saved projects, named preset storage and user preferences are not deleted by the exact-file uninstaller. Never disable security warnings. No signing keys were created.

## Retained limits

JPEG/PNG/WebP import and JPEG/PNG export remain 8-bit sRGB. Basic/local original-size work is limited to 64MP/16384-edge; complex portrait/background/manual/selection-layer effects to 16MP before crop. Working-size 4096 output is explicit. Crop is integer/90-degree/flip only. Source documents embed original compressed bytes; no autosave, RAW/16-bit/proofing, perspective or arbitrary rotation is added.

Dedicated learned skin/blemish retouch is still unresolved. SegFace is experimental parsing, not learned retouch; BiRefNet remains quality-blocked. Existing landmark-assisted/classical beauty is not claimed SOTA. No new model, private-photo upload, API call, fee, credential, public publication or user-computer action occurred. All 103 audit work packages retain full_acceptance_passed=false. QA portraits are private informational fixtures and excluded from installed payloads, not product marketing or endorsement.

## Restore

Apply this overlay over base Library libfile_409356280a8c8191a5bf3fd3cbdffe91 v1. Dependencies, runtimes, model weights and executables are excluded; restore/build them separately from pinned approved sources when authorized. CHECKPOINT-FILES.json hashes every included file except itself. Historical reports apply only to their recorded snapshots. Previous checkpoint 8 is retained at docs/checkpoints/SOURCE-PRESETS-CHECKPOINT8.md. The next reference-comparison capability is being audited, not present here.
