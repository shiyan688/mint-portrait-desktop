# Desktop source checkpoint16: shadows, highlights and neutral-patch white balance

2026-10-22. Unreleased source increment only; delivered development0.2.4 and stable0.1.1 installers remain unchanged. The previous source-only checkpoint15, separate QA checkpoint15 and full checkpoint14 are retained.

## Actual result

Right-side “明暗与白平衡” provides independent -100…100 shadows/highlights, neutral-patch picker, gain readout, gain-only and whole-group reset. The sampler temporarily renders the actual healing → beauty → basic-tone input, never the later Levels/Curves/manual/background/framing/text result. It rejects missing upstream face facts, unsuitable patch statistics, stale/mismatched frames and cancelled gestures. Entering/cancelling a picker is display-only; successful sampling is one undoable parameter change.

The shared core is traditional 8-bit sRGB processing, not learned retouch, RAW recovery, Kelvin measurement or natural-beauty default. It applies linear RGB gains, a monotone eased luminance curve, and common RGB scaling/maximum normalization. In-gamut linear RGB ratios are preserved; out-of-gamut pixels sacrifice target luminance. The first white-mixing reconstruction visibly made portraits gray even at moderate strengths and was rejected, not released. Exact old code, numeric results and actual image negative controls remain in the separate QA bundle. At extreme values, tone/contrast and apparent saturation still change strongly.

Core SHA256: bfd8cb0be2fbdaea50ce59b5646cf6a99ae3a980fdb97cd554a901761860dac1.
Preset codec SHA256: b03d59aab2fa6b32639ceb1ddc0d22e680adde21a2834aece6cea9e79645e5d6.

Projectv10 reads1–9 and validates the new group in current/committed/exported/undo/redo settings. Presetv3 reads1–2, preserves existing groups and stores no photo, path, landmarks, geometry or sampling location. The old0.2.4 app cannot open these new formats; preserve old backups. Copy settings, named presets and batch export use the same deterministic stage ordering. Main-process preset storage has the real module dependency, not a renderer-only shim.

## Confirmed validation

- 2196/2196 final direct Node tests passed, zero failure/cancel/skip/TODO. Old initial failures were obsolete schema/layout fixture expectations; the negative unknown-version case now uses unsupportedv4 rather than newly validv3.
- 113/113 focused core/integration/UI/independent-workflow tests replayed after final promotion. The earlier independent audit and its original hashes are separately retained; final replay is not misrepresented as a second independent audit.
- 41/41 opt-in candidate/evidence checks, including14 full-resolution direct-core PNG round trips. Original five hue-ramp bounds remain≤8 codes:2/2/2/8/3. Broader243 extreme gain/tone cases reach13, so universal absence of8-bit banding is not claimed.
- 11 actual production native PNG outputs over two public portraits and a controlled WB experiment exactly match the shared core. Actual comparison pixels were viewed. Controlled gray-card color-cast RGB MAE9.344→0.414, max2 codes; not real-scene illumination ground truth.
- All five active preset groups replay identically through independent stage assembly and native export at897×1000. FinalRGBA SHA63a27a4dfef6e425923241e9ac8d642b19f5100890b88cd46ace31230fde3162. Mobile comparison status is recorded in the companion parity report, not assumed here.
- 22/22 source/QA archive tests passed. The selector adds only the light-balance QA subtree; research weights, fonts, installers, dependency folders and private feedback screenshots are not included. Source and binary evidence remain separate.

## Limits and evidence

No real browser/Electron window, Windows/Android device,4060 performance or color-managed-display acceptance. Existing source budgets and original preservation remain unchanged. SegFace is analysis only; BiRefNet quality remains blocked; accepted dedicated learned portrait retouch still missing. No new model execution, API/photo upload, fees or signing performed.

See docs/LIGHT-BALANCE-DESKTOP-UI.md, LIGHT-BALANCE-CONTRACT.md, LIGHT-BALANCE-PERSISTENCE.md, LIGHT-BALANCE-CHROMA-REVIEW.md and the 103-package coverage ledger. All full-work-package acceptance marks remain false. CSV IDs now round-trip from authoritative JSON, correcting an earlier BOM-key omission without changing acceptance.

QA-RESTORE.json identifies the exact separately persisted QA version and hashes. This is a source overlay over libfile_409356280a8c8191a5bf3fd3cbdffe91 v1, not a complete dependency/runtime archive. Use tools/archive-checkpoint.py to verify/restore the evidence before fixture-dependent tests. No new Setup.exe was created for this source milestone.
