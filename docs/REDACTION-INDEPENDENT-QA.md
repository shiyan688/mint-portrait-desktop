# Independent desktop redaction audit

Date: 2026-10-22. Scope: the cloud-verifiable desktop mosaic/opaque-cover candidate. No personal photos, remote services, models, fees, downloads, installers or production dependency changes were used.

## Result

The independent suite passed **24/24 tests, with zero skips**:

    node --test tests/redaction-independent.test.cjs

The run log is `quality/redact-qa/independent-test-output.txt`. The reproducible sample builder is:

    node quality/redact-qa/independent-sample.cjs

This is a focused independent audit, not a claim that this document's author ran the entire repository suite. No production defect remained exposed by these checks. Production files were not edited by this audit.

## What was proved

- A separately written scalar point-to-segment capsule oracle verifies every byte in hard-cover results, including one-pixel-wide/tall inputs. Hits receive the exact requested RGB and alpha 255. Outside-hit bytes are unchanged. Source bytes, settings and layer metadata remain unchanged.
- A separate scalar cell-average oracle verifies mosaic RGB is weighted by source alpha, retains source alpha, and composes layers in order. The shared core intentionally retains pre-export hidden RGB at alpha zero; that is not an export guarantee or a secure-redaction claim. Export sanitation is tested separately.
- A separate forward-coordinate oracle maps a binary source brush selection through quantized asymmetric crop, all 16 combinations of quarter-turn and X/Y flips, and asymmetric padding. It checks every resulting pixel rather than reusing the production selection transport as its expected answer.
- Selected opaque cover rejects feathering. Selected redaction plus shape warp rejects. Project validation and native pixel replay reject source- or geometry-stale recipes rather than moving the strokes silently.
- Real `app.js` pointer handlers keep a pink guide separate from stored settings. Pointerup creates one history item. Pointer cancellation, lost capture, Escape, blur, compare, source-view entry, changed recipe, changed source revision, undo, pagehide and multiple pointers cannot commit the draft.
- The app captures an owned snapshot of the current selection. Later selection mutation cannot alter the existing layer. Feathered selected cover fails before draft/history creation.
- Original/source inspection remains visibly described as not displaying final redaction; a cover cannot begin in that view. Returning to the final canvas restores the existing redacted result without modifying the original.
- Sync and built-in presets retain the target photo's own redactions and never copy another photo's cover. A missing redaction adapter cannot publish an accepted uncovered preview.
- The complete native order is checked as **source effects → crop/turn/flip → padding → text → redaction → optional final resizing → PNG/JPEG encoding**. Expected redaction is independently computed from the upstream composite, so a cover placed before tone, text, or padding would fail.
- Actual Sharp PNG exports match the expected final RGBA bytes, with fully transparent RGB sanitized to zero. JPEG is compared against the explicit white-flattened, quality-100, 4:4:4 native encoder result. Native final downsampling is compared against Lanczos3 applied after redaction. Exporting cannot mutate source bytes or recipe/text metadata.
- An additional end-to-end app export test uses production `app.js` orchestration, real installed NativeCanvas text rasterization, and the real Sharp native export worker. A pending pink guide is canceled and never enters the exported settings. The covered center is exactly the requested RGB/255 in the real PNG.

## Actual output evidence

All evidence lives in `quality/redact-qa/`:

- `independent-source.png`: 800 × 520 generated checkerboard and synthetic source labels, not a portrait or private identifier.
- `independent-native-before-cover.png`: 580 × 852 native crop/turn/flip/padding/text baseline. The synthetic center identifier is visible.
- `independent-native-cover.png`: 580 × 852 native PNG returned by the production app's export flow. The center identifier is fully replaced by the dark opaque capsule; the lower capsule demonstrates mosaic only.
- `independent-native-cover.jpg`: native JPEG of the same captured production request, deliberately flattened onto white.
- `independent-native-cover-downsize.png`: 218 × 320 native final-output reduction of the same request.
- `independent-sample-manifest.json`: exact artifact hashes, dimensions, output metadata facts and production-source hashes.

The before/after PNG and covered JPEG were visually opened and inspected. They are actual generated image files, not screenshots or reconstructed UI mockups. The covered PNG has **160,736 alpha-zero pixels with zero nonzero hidden-RGB pixels**. The reduced PNG has **20,256 alpha-zero pixels with zero nonzero hidden-RGB pixels**. Each output has no EXIF, XMP or IPTC metadata. A retained sRGB profile is intentional.

## Important limits and privacy wording

1. These UI checks run unmodified production `app.js` in an authored DOM/IPC shell with installed NativeCanvas. They do not prove Chromium/Electron/Windows event dispatch, pointer capture, window lifecycle, accessibility, font selection, screen layout, packaging, installation, or a real native save dialog. VM-to-host plain-data normalization and the NativeCanvas getImageData options adaptation are explicit in the reused harness.
2. NativeCanvas 0.1.100 is an existing development/QA prerequisite, not a shipped production dependency. Native acceptance cases fail with an actionable prerequisite message when it is unavailable; they do not silently skip. The app harness is lazy-loaded so focused pure/Sharp tests need not load it.
3. The PNG hard-cover guarantee applies to the native composition before lossy encoding or resizing, and to unchanged-size PNG output after sanitation. JPEG and output reduction alter boundary values. Partial-alpha pixels outside the cover remain image content. Inspect the exported copy at its final size; a small preview is not evidence that an original-size export is correct.
4. Mosaic is only a visual effect, not reliable anonymization. A hard cover must actually include all sensitive content, with suitable margins for subsequent resizing. This audit is not a guarantee that any arbitrary user-drawn coverage is sufficient.
5. Original files, editable projects, undo/history and recovery drafts intentionally retain original pixels or source recipes. They are not safe substitutes for an inspected exported copy and must not be represented as redacted deliverables.
6. This audit does not claim privacy merely because RGB under alpha zero is sanitized. Visible and partial-alpha information, uncaptured regions, file naming, and information outside the picture remain separate concerns.

## Audit ownership

Only `tests/redaction-independent.test.cjs`, `quality/redact-qa/independent-*`, and this report were authored or modified by this audit. Its failed exploratory checks were harness/oracle setup issues, not production changes: mosaic's intentional alpha-zero preservation was modeled explicitly, the text font enum is `mono`, and the authored asynchronous preview queue was allowed to settle before testing the current accepted frame. Final acceptance is the zero-skip 24-test run above.
