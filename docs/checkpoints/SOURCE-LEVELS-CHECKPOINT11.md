# Unreleased desktop checkpoint 11: Levels and manual/framing repair

2026-10-22. This source-only increment adds conventional Levels after checkpoint 10 frozen-reference comparison. Package version and saved installers remain 0.2.2; those executables do not contain checkpoint 10/11 changes. Stable 0.1.1 identities remain untouched. This is not full PixelCake/Xingtu coverage or accepted SOTA portrait retouch.

## Usable source increment

The desktop color rail now has master RGB and individual R/G/B Levels: integer input black/white, gamma 0.1–10, integer output black/white and one overall strength. Input endpoints cannot cross; output endpoints may coincide. Gamma greater than 1 brightens midtones. The shared pure 8-bit sRGB implementation keeps floating-point master→channel mapping until one final half-up rounding, blends strength once, preserves alpha/hidden RGB and source pixels, and rejects malformed recipes. Neutral/null/zero-strength is exactly unchanged. This is user-selected display-referred color processing, not RAW/HDR highlight recovery or a natural-beauty default.

Order is beauty → basic tone → Levels → curves/HSL → local layers → existing manual/background/reshape → final framing. Live edits commit once to history. Resets, undo/redo, per-channel controls, full/color-only preset application and batch copy preserve unrelated image state.

Project version 7 writes explicit Levels in current/committed/history/exported settings. It reads versions 1–6 with null migration and preserves source bytes, hashes, geometry, manual and review data. Properly hashed malformed v7 records reject, not silently strip. Portable presets write v2 with basic/beauty/levels/advancedTone; exact v1 input migrates to null Levels. Reading old local catalogs does not rewrite them; explicit later saves keep previous exact bytes as backup. Android v2 integration is separate and not claimed complete here. Existing v1 cross-platform evidence is not a substitute for v2 validation.

## Corrected pre-existing combination defect

Manual liquify without a following repair returned transient diagnostic metadata. Feeding that object directly into the strict final Geometry core rejected preview/export even with Levels disabled. The two controlled pipeline boundaries now construct only {width,height,data}; strict Geometry validation remains unchanged and there is no raster copy or loss of source data. Five targeted tests failed before repair; all pass afterward, including actual PNG export, original invariance and undo/redo replay. Four additional independent neutral/rotated-and-flipped cases cover Worker/native/PNG. Existing stale-mask/automatic-landmark/transparent-source guards remain enforced.

## Verification

Final direct Node suite: 1449/1449 passed, zero failures, skips or cancellations. Log: checkpoints/levels-full.log. Core 30, new UI 22, own contracts 18, independent 57 and targeted old-combination 5 are included, not additional to the total. Authored DOM/IPC/Canvas test doubles exercise production handlers; native pixel export uses real worker threads and installed Sharp. These are not browser/Electron/Windows interaction tests.

Independent scalar oracle checks 614,400 full-ramp values. Eight real portrait/synthetic native PNG exports decode with zero byte mismatch against that oracle. Neutral changes zero pixels. I inspected quality/levels-qa/portrait-levels-contact.png and synthetic-levels-contact.png; the user-chosen moderate adjustment preserves visible texture, and extreme endpoint stress intentionally clips colors, explicitly not a default. The NASA portrait is private factual QA only, not an application asset, endorsement or aesthetic benchmark.

The core inherited-setter and inherited-property-descriptor getter defects found during development were fixed before freeze. Shared Levels SHA256: 1e454e275c24e2e99b7b6e32bad3569a3ce996e73e2d8cc895c00aea5daf327f. Shared preset v2 SHA256: 30b4f98139e9fef2d4e3b6dffc2cf0d4594862039623fa02c3877cacfc6fe5ab. Remaining source hashes are in checkpoints/levels-source-hashes.json.

## Retained constraints

Previous checkpoint 10 reference-copy QA discovered an optional native Canvas library discrepancy for a special pre-encoded copy/repaint sequence. Its reproducer and accurate Sharp-encoded readback evidence remain preserved; no browser verification is claimed. Reference state remains session-only, max 1280 preview, not original 1:1 inspection or project data. Details: docs/checkpoints/SOURCE-REFERENCE-CHECKPOINT10.md.

JPEG/PNG/WebP input; JPEG/PNG output, 8-bit sRGB. Basic/local/color original processing up to 64 MP / 16384 edge; complex portrait/manual/background/selection effects up to 16 MP before crop. Explicit working export 4096 differs from interactive preview 1280. No RAW/16-bit proofing, arbitrary rotation, perspective, autosave or full crash recovery. Learned skin/blemish retouch remains unresolved; SegFace is experimental parsing and BiRefNet remains quality-blocked. Conventional manual/color effects are not SOTA.

No new dependency, model execution, browser/socket retry, API, private-photo upload, fee, credential, publication or user-computer action. No new Setup. Coverage remains partial; none of 103 work packages is marked fully accepted.

Restore this overlay over base Library libfile_409356280a8c8191a5bf3fd3cbdffe91 v1. Dependencies/runtimes/model weights/executables are excluded. CHECKPOINT-FILES.json verifies every included file except itself. Historical build/package reports apply only to their recorded source snapshot. Production package allowlists exclude QA portraits and tests.
