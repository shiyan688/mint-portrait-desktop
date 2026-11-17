# Frozen reference / current-photo comparison

Initial module checkpoint: desktop 0.2.2 source candidate, session-only UI work with project schema6. The later 0.2.3 bundle uses overall project schema7 for Levels; reference view state remains excluded from all project versions. This module itself does not change pixel/export math, models or dependencies. Actual installer inclusion is established only by the corresponding package manifest.

## User workflow

1. Finish processing the current photo in the ordinary framed edit view.
2. Choose **固定当前处理预览为参考**. The left pane shows **冻结参考** with captured photo name, time and framed preview dimensions. The right pane shows **当前照片**.
3. Edit, navigate or import other photos on the right. The left bitmap never refreshes automatically. This is not simultaneous processing of a second photo.
4. **替换参考** explicitly replaces the single snapshot; **清除参考** releases it. **参考对比** toggles the comparison without deleting it. The existing **原图 / 调整后** wipe and reference comparison are mutually exclusive.
5. Drag or wheel either pane to synchronize normalized center and relative-fit zoom. **适合两侧**, toolbar Fit or F returns to the center and each image’s own aspect-preserving fit. Space holds the framed original on the right only.

Manual tools, legacy point repair, crop drafts, matte, local-range, face-box, parsing diagnostics and other source-coordinate inspections suspend the comparison, retaining the snapshot. Returning to a supported view requires a new accepted framed render. Entering reference comparison never resets an inspection or photo recipe to make it work.

## Capture and provenance

The snapshot copies only the accepted `rendered` canvas, never the composed `previewCanvas`. The latter can contain wipe, held-original, manual overlays or diagnostics.

The app records an accepted-render capability containing the photo object, immutable source Blob identity, source revision, working input object, exact bounded full recipe key, view token, render generation, display mode/stamp and output dimensions. Ordinary review-only revisions do not invalidate unchanged pixels. Same-frame tone or nested recipe changes do invalidate capture even before history commit.

`scheduleRender` invalidates acceptance immediately and sets a separate `renderPending` flag. Timer truthiness is never used as evidence. Failed, aborted, late, wrong-source and outdated renders cannot authorize capture. Loading, analysis, render/debounce, project/preset/export/backend work, gestures/drafts, held original and inspection modes refuse capture. Capturing while in the old original/edited wipe also refuses without switching it off.

The full recipe key is checked at render acceptance and repeatedly at the capture boundary, including after the copy and immediately before replacement commit. A discovered mismatch invalidates acceptance. Drag, wheel, layout and ordinary preview drawing do not repeatedly serialize potentially large manual histories; they use explicit invalidation and identity/generation checks. Recipe-key safety failure disables reference capture but does not prevent otherwise valid ordinary rendering or export.

The returned frozen metadata retains bounded strings, full canonical recipe key, generation, view token, mode, original dimensions, working-preview dimensions and framed snapshot dimensions. It does not retain a photo object, original Blob, learned cache or second editable recipe. Original dimensions are provenance only, not a claim that the reference is original-resolution.

## Memory and replacement

The actual normal preview decoder is bounded to 1280 pixels on its longest edge. Dimensions and provenance are validated before allocation. One snapshot is at most 1280 × 1280 × 4 = 6,553,600 bytes (6.25 MiB) of RGBA storage. Replacement temporarily retains old + candidate, at most 12.5 MiB of snapshot RGBA. The bounded recipe string is additional metadata.

This is not a bound on total browser/GPU/process memory, which includes the source, existing rendered/preview canvases, render intermediates and implementation overhead. The right pane mounts the existing accepted render or framed original instead of allocating another image. The left pane directly mounts the one frozen canvas. There is no original-resolution decode, data URL, Blob, readback ImageData, model invocation or learned-cache duplication for a capture.

Canvas drawImage creates independent backing pixels. The previous reference is retained until copying, freshness revalidation, mounting, UI updates and draw work all succeed. Any failure restores the prior snapshot/view/host and disposes only the candidate. Clear, successful replace, source-photo removal, committed project replacement and page exit remove discarded canvases and set their width and height to zero.

## Navigation contract

`reference-compare.cjs` is a dependency-free CommonJS/browser global (`MintReferenceCompare`) module:

- `fitView()` → `{u: 0.5, v: 0.5, zoom: 1}`.
- `normalizeView(view)` clamps finite normalized center to [0,1] and fit-relative zoom to [1,16].
- `layout(view, imageSize, paneSize)` returns finite aspect-preserving width/height/left/top/scale plus validity.
- `pan(view, {x,y}, imageSize, paneSize)` converts initiating-pane pixel movement to normalized movement.
- `zoomAt(view, factor, anchorPx, imageSize, paneSize)` preserves the initiating normalized anchor except when explicit center/zoom bounds clamp it.
- `boundedSize(width,height)`, `recipeKey(settings)`, `capture(canvas, provenance, createCanvas, isCurrent)` and `dispose(snapshot)` implement capture guards and ownership.

Linked movement is not face registration. Pixel offsets are not copied between differently sized/aspected panes. Each image fits its own pane, with the same normalized center and fit-relative zoom. A normalized center can reach an image edge, so visible background/letterboxing is intentional even at fit zoom; strict per-pane edge clamps would desynchronize different aspects. Fit explicitly recenters both. No “100% original” control is offered.

Invalid, zero, vanishingly small or out-of-range dimensions are guarded and cannot emit NaN/Infinity. Comparison gestures have their own captured pointer and are explicitly released on clear, replace attempt, mode/photo change, resize, Escape, blur, pointercancel, lost capture, wrong pointer or a second pointer.

## Session, project and export invariants

Reference state never enters photo settings, review, undo/redo, dirty fingerprints, project snapshots, preset data or export queues. Switching, importing, filtering, saving and exporting retain it. Removing the referenced source photo clears it; removing unrelated photos does not.

Project cancellation, invalid input, declined replacement, staging failure and install rollback preserve the old reference. Only a committed project swap clears it. The right pane removes old current-photo pixels as soon as processing/switching begins and displays loading or failure instead of labeling an old photo with the new photo’s name. Selective latest-wins decode guards remain intact; no broad `locked()` check was added to `activatePhoto`.

Project, preset and export completion paths reschedule a fresh preview after success, cancellation or failure. Tests explicitly let a pending preview timer enter `renderCurrent` while each operation is busy, then verify recovery without another slider edit.

## Verification and limits

Run direct Node tests, not npm:

    node --test tests/reference-compare.test.cjs tests/reference-compare-ui.test.cjs tests/reference-compare-independent.test.cjs
    node --test tests/*.test.cjs tests/manual-qa/*.test.cjs

The authored UI tests execute the shipped app’s actual handlers with DOM/Canvas/IPC doubles and real existing project, geometry, review and export pixel cores. They cover immutable snapshots, accepted-render provenance, changed uncommitted tone recipes, late/failed/aborted renders, transaction rollback, mismatched aspects, pointer cancellation, source switching, project/import/save/export lifecycle, mutation isolation and export RGBA invariants.

Two native raster tests use the already-installed `@napi-rs/canvas` (Skia) to verify independent opaque/transparent/semitransparent copying and maximum 1280 × 1280 capture. This optional test facility is not a new project dependency. Test output reports skips explicitly if it is unavailable; it was available in the cloud verification environment.

These are not Chromium/Electron interaction tests, Windows screenshots, native dialog tests, device performance measurements or model-quality validation. No preview endpoint, browser socket retry, installer build, model download or private photo was used. Actual desktop layout and interaction remain a separate Windows validation step.

### Frozen candidate verification, 2026-10-22

- Full direct Node suite: **1317 passed, 0 failed, 0 skipped**.
- Reference-specific: 14 pure/native-raster tests, 67 authored app UI tests, and 71 independently authored safety tests.
- Independent cross-regression (reference + project + review + geometry UI): **326 passed, 0 failed, 0 skipped**.
- Independent busy-state tests additionally use real timer delivery, including canceled preset application and failed preflight, and observe automatic recovery without manually calling renderCurrent as a rescue.
- Syntax validation passed for the browser app module and reference CommonJS/browser core.
- App SHA-256: `73faacb87820ee9708dfe6f520f7636ae581b7337f99293acf002b1624efbdc4`.
- Reference core SHA-256: `30b83d4c044ccb8fdfa602c0388247242064959f2c5c5bfedcb83a79ba8f33f9`.
