# Learned-model UI integration QA

Date: 2026-10-21. This is an independent state/coordinate audit of the shipped application functions, not a browser interaction report or a model-quality benchmark.

## Executed verification

`tests/learned-ui.test.cjs` evaluates the current `src/app.js` module in Node's VM with authored DOM, canvas, pipeline and desktop IPC doubles. It calls the actual app functions and listeners, and uses the real `src/learned-analysis.cjs` coordinate/validation helpers. Synthetic IPC replies deliberately have the production result shape; no reply in these tests is a model inference result.

Final focused checkpoint at 20:02 UTC: **54 UI lifecycle/model-selection tests passed**. The combined command below also passed the existing general UI, model-panel, helper, learned-alpha pixel, original-decoder and manual-mask-kernel suites: **89 tests passed, zero failed**. `node --check src/app.js` also passed. Source hashes were unchanged before and after this final run.

```sh
node --test tests/learned-ui.test.cjs tests/learned-analysis.test.cjs tests/learned-matte-pixels.test.cjs tests/learned-original-decode.test.cjs tests/mask-correction.test.cjs tests/audit-ui.test.cjs tests/backend-panel.test.cjs
node --check src/app.js
```

No model inference, research-code execution, private-photo processing, real IPC subprocess, browser launch or filesystem image export is performed by the new UI suite. Real SegFace CPU evidence is separately recorded in `quality/segface/README.md` and must not be inferred from this suite.

## Covered behavior

- Explicit face choice uses the corresponding detected mesh. Requests crop the original decoded image rather than the resized preview, with exact original-pixel ROI and source-revision metadata.
- Missing face choice, unavailable model, scaled/mismatched original decode, oversized original input and exhausted cache budget fail closed before backend submission.
- Matting requests cover the complete original image and retain continuous float alpha. Preview creates a derived downsampled mask; original-sized render/export facts retain original alpha.
- Repeated run is single-flight. Cancellation before original decode finishes prevents IPC submission. Late replies after cancel, switch, switch-away-and-back, removal or source-revision change cannot enter the photo cache or settings.
- Completing an older cancelled job cannot clear or overwrite its replacement. Failed reruns preserve the previous usable matte and settings.
- Wrong ROI and weight digest are rejected. Cached results are bound to photo ID, source revision and original dimensions.
- SegFace diagnostic overlays draw over the original source, not an already transformed preview. Destination coordinates are the ROI's original coordinates scaled to preview size, with floating-point tolerance. Holding the original view suppresses diagnostics.
- Undo/redo and reset/undo restore per-photo cache references without another model call. The cache is not evicted to satisfy a new request when doing so could break undo.
- Parameter synchronization preserves each destination photo's own learned mask IDs and diagnostic settings; it does not copy another photo's cache.
- Export is blocked while a learned job is pending. Learned-matte export uses the original decoder and original alpha, never a silently resized or legacy fallback. Missing/stale caches and scaled original decodes produce no export write.
- The diagnostic preview canvas is never passed to export encoding.
- The real model-panel module is also tested with authored probe/DOM doubles. A missing desired model, changed version or incompatible selected device does not silently select another model or return to CPU. The user can explicitly select a ready alternative.

## Original-source manual mask correction

The new brush tests dispatch authored pointer/key/button events to the actual registered app listeners. They do not simulate a real browser event loop, pointer capture or CSS layout.

- Keep/remove strokes save original-image pixel coordinates, original-pixel radius, hardness and opacity, independent of the resized preview and mocked surface placement.
- A completed gesture is one undoable stroke. Multiple samples in one stroke do not multiply opacity; the real pure kernel unions coverage before blending.
- Keep/remove edits affect a derived alpha array. Cached learned-model alpha stays byte-for-byte unchanged. Manual correction provenance remains explicitly `learned: false`.
- Undo, redo, clear-corrections and undo-clear reproduce the expected original or corrected alpha, without another model run.
- Pointer cancellation, lost capture, Escape, blur, photo switch, source-revision change, disabling the matte and raw-model inspection discard an uncommitted draft.
- Export opening, direct export start, entering the held-original view, fit and zoom navigation also discard drafts. Late pointer-up events cannot apply those discarded strokes.
- Missing matte, held-original view and outside-image points cannot begin a brush. A rejected kernel parameter leaves settings, alpha and undo history unchanged.
- Parameter sync does not transfer source-photo brush strokes; it retains each destination's own corrections.
- Export consumes the same full-original corrected alpha used to derive the preview, not a second repaint at preview size. Raw-model inspection is view-only and does not silently disable exported corrections.
- Learned-only background export succeeds even when the authored legacy-analysis double would throw. Optional face analysis cannot replace the selected learned alpha with a legacy mask.

## Audit findings resolved during implementation

1. Renderer boundary validation was strengthened by its owner: exact 19-class vocabulary, explicit ordered skin+nose union, conservative policy version/kind/original-pixel guard, and skin/protected complement tolerance. Eight malformed-policy/vocabulary/complement variants now reject before cache insertion.
2. Code review found that draft gestures originally survived export entry and held-original view. The UI owner added explicit draft discard at both export entry points and on entering original view, plus fit/zoom navigation. New targeted tests pass for all of these paths.
3. The UI owner removed an unnecessary legacy-segmentation dependency for learned-only background export. A regression test verifies that export does not call the unavailable legacy analyzer; optional face analysis still preserves the learned matte.

## Observations and limits

- The final focused test set has no unresolved failure. Initial harness assertions were corrected to allow arithmetic round-off and to read export errors from the export dialog rather than the global status, which the subsequent preview render can overwrite.
- Normal Chromium launch was previously blocked by an environment socket `EPERM` error. This audit did not retry or bypass that restriction. Layout, pointer delivery/capture, canvas display, native dialogs and actual Electron interactions remain unverified here.
- Authored mocks cannot establish real backend cancellation latency, process cleanup, GPU performance, perceptual quality or Windows behavior. Existing dedicated backend and pixel tests are separate evidence.
- This is a focused verification, not a claim that the complete application test suite or packaged Windows release passed.

### Source checkpoint hashes

- `src/app.js`: SHA-256 `444e5950ce407a86895a8cf5183f6f653fb2104e1520d3df4b3c9567e6d0bd80`
- `src/learned-analysis.cjs`: SHA-256 `3ac9c1fbf8d9e5d3d51b7cba3f791922e6fc58ead62b9e49d4fe76583ffb9bb8`
- `src/backend-panel.js`: SHA-256 `25084eb36d4c37d2b87b71a7b5fa54fd57b19fc5a1ed999f46d12b3de8f283c2`
- `tests/learned-ui.test.cjs`: SHA-256 `0e612ef7776f70fe1351edfffb1937b837b9073004db370b34d56d1d42554bd4`

## Ownership

This audit edits only the new UI test file and this report. UI code and the mask-correction kernel remain owned by their implementation authors. Re-run the command against the final source after subsequent UI changes; a historical pass is not proof of later code.
