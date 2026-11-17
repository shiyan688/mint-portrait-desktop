# Desktop selection, liquify, heal and clone candidate

This is a conventional, offline editing implementation, not learned facial repair or a claim of professional/SOTA quality. It is separate from both the old single-point color-softening tool and the learned-person-matte correction brush.

## Workflow

1. Open a photo and choose **选区画笔** or **自由套索**. Add or subtract a region, adjust feather, invert it, or choose an explicitly empty selection. Cyan is only a preview overlay. **清除选区限制** restores unrestricted editing; an explicit empty selection protects the entire photo.
2. Optionally create a local adjustment layer from the current selection. It is an independent, source-bound selection snapshot; exposure, contrast, saturation, temperature, layer strength, order, and undo work like other local layers. Later selection edits do not change that layer's mask. Create this layer before manual push/repair: conversion is deliberately blocked once manual strokes exist, since local layers run before geometry. Existing layers are naturally warped with their image pixels. Inspecting a layer range uses the unwarped original image, not a misleading post-warp overlay.
3. Choose **推拉** or **恢复形变**, set radius and strength, then drag. Release to apply exactly one stroke. Restore reduces previous manual deformation; it does not undo tone changes.
4. For blemishes, choose **修复涂抹** (texture plus local color matching) or **仿制图章** (texture copying). Choose a clean donor using **选择取样点**, then make a short stroke over the blemish. Adjust radius, hardness and strength. Every new stroke restarts at the marked donor; within a stroke the offset is fixed. Both modes require explicit manual sampling in this desktop candidate. There is no automatic acne detection or automatic donor-search control.
5. **完成 · 看完整效果** disables manual mode and recomputes the complete image including background handling and automatic face reshaping.

Manual editing waits for a specially rendered working view. It retains baseline retouch, tone, local layers, and previously committed manual operations, but intentionally omits background replacement and automatic facial reshaping. Pointer positions are normalized against the image surface, not the viewport, and replay as `x * (width - 1)` / `y * (height - 1)` with brush radii as short-edge fractions. They are bound to the immutable original source revision. No preview-sized raster mask replaces the original image.

Current selection state never changes the image by itself. Each applied stroke captures an independent selection snapshot at pointerdown. Applied strokes, selection edits, and selection-backed layers are part of normal undo/redo and project persistence. Presets retain a photo's manual work. Cross-photo parameter synchronization never copies source-bound selections, strokes, or local layers.

## Transaction and cancellation rules

A pointer stroke is an ephemeral draft until pointerup. Escape, pointercancel, lostpointercapture, window blur, source revision changes, changing tools, zoom/fit, viewing the original, opening export, and project save discard unfinished drafts. No image pixels, history entry, or saved command is produced by a canceled draft. An in-progress pointer ID cannot be replaced or committed by a second pointer.

Manual push/restore requires original background and zero automatic facial reshape. Conversely, automatic shape/background changes are refused while manual liquify exists; preset and parameter-sync combinations retain the target photo’s compatible shape/background settings and explain the exclusions. This avoids reusing stale original-space face landmarks or segmentation after geometry changes.

Push/restore and clearing liquify are blocked while repair strokes exist, because the fixed processing order is local edits → manual geometry → repair. Complete geometry before repair, or undo/clear repair before changing geometry. The application does not flatten or replace immutable original files to work around this constraint.

Repair preflight reads an immutable RGBA snapshot of the actual manual working image captured at pointerdown. The genuine shared texture-patch core validates the selected source, complete swept donor footprint, overlap, edge transparency, short-stroke bounds and heal color support before any history commit. Source/target pixels are not mutated by preflight; export replays saved normalized commands on the original-resolution pipeline. Invalid donor or overlong strokes show an error instead of being silently saved. Source markers and sampled pixel buffers are transient; resolved command source coordinates and selection recipes persist in projects.

## Limits and validation

The desktop UI currently permits 64 selection commands, 64 liquify strokes, or 64 repair strokes and 512 samples per pointer stroke; stricter aggregate work/memory limits in the shared core still apply. Invalid or stale recipes are rejected, not applied as unrestricted edits. A push needs movement; a lasso needs a nondegenerate polygon. Cancellation and pointer motion do not add entries to history. Clearing/replacing a selection is an undoable edit.

## Verification

Run `node --test tests/manual-tools-ui.test.cjs` for executable shipped-app DOM/pointer/state tests using authored DOM/canvas/IPC doubles and the real shared kernels and project codec. The suite covers cancellation, pointer ownership, zero and reversed coordinates, source binding, view readiness, immutable snapshots, history, persistence, parameter-sync isolation, selection-backed layer controls, and preview/export separation.

Repair-specific tests exercise the genuine shared heal/clone implementation, manual donor picking, immutable source pixels, cancel routes, invalid source/overlap/length refusal, saved selection snapshots, project persistence and post-liquify sampling.

These tests are not native browser screenshots or Windows interaction QA. Browser file navigation and local Chromium startup were blocked in this execution environment; no retry, workaround, or fabricated screenshot is used as evidence. Real native export/pixel integration is covered by the separate pipeline/export test suites.


The kernels preserve destination source alpha. Liquify currently changes RGB geometry, not an imported transparent image's alpha silhouette; it is not a full RGBA cutout-warp tool. General manual retouch/export remains16-million-pixel,8-bit sRGB. The public portrait evidence is private informational QA only and is excluded from the application. Artificial lesion overlays and tester-selected natural tonal marks do not establish acne ground truth, automatic repair, universal texture preservation or professional/SOTA acceptance.
