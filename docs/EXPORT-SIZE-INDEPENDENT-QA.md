# Final export dimensions: independent QA

Verified 2026-10-22 in the authorized cloud workspace. No production code was changed by this audit.

## Result

- Independent suite: **16 passed, 0 failed, 0 skipped**.
- Combined final-size, native-renderer, text-contract and queue regression suite: **83 passed, 0 failed, 0 skipped**.
- No production defect found. Two initial test-only issues were corrected: cross-realm array comparison in the authored VM, and matching a newly translated no-upscale error.
- The parent owns the whole-repository aggregate run. These focused results do not claim the aggregate or Windows acceptance passed.

## Real native pixel evidence

Synthetic source **900 × 640** receives exposure, crop, quarter-turn/flip, padding and three multilingual styled text layers. Its finished composition is **634 × 851**. The requested long edge371 produces **276 × 371**, with 2447 full-resolution glyph pixels located in actual bottom padding.

The full composition matches an independently written scalar source-over oracle byte-for-byte. The smaller native PNG matches a separate final resample of that completed full composition byte-for-byte in decoded RGBA. The unchanged full-resolution text overlay is reused. A control that instead rerasterizes text at final dimensions differs in 37101 channel values, maximum difference157; that incorrect path is not used.

Final decoded RGBA SHA-256:

`4113da002a085d02ce7715e426affa4b0689a60ca7d30357701687fe65a8ee4d`

Expected completed-composition-resample SHA-256:

`4113da002a085d02ce7715e426affa4b0689a60ca7d30357701687fe65a8ee4d`

The alpha fixture's encoded source contains **6303** fully transparent pixels with hidden magenta RGB. Replacing that RGB with zero produces exactly the same resized PNG pixels. All **817** alpha-zero output pixels have zero RGB. Native JPEG is byte-identical to independently encoding the final resized RGBA after white flattening, not flattening before resize.

## What was exercised

1. Exact long-edge, positive half-up short-edge rounding, minimum1px, both orientations and equal-edge identity. The small-dimension sweep checks7,203 plans.
2. Strict own-data recipe fields; no getters, symbols, unknown/non-enumerable/inherited fields, numeric coercion or implicit upscaling.
3. Tiny final requests cannot bypass source64MP/16384, expanded-canvas, portrait-processing16MP or text-composition16MP limits.
4. Omitted and unchanged native requests preserve old encoded PNG bytes and legacy plan shape; equal-edge requests do not resample.
5. Output controls do not alter edit settings, history, source pixels, saved project, accepted preview or text-raster basis/cache.
6. Invalid final-size forms and over-budget text fail before native submission. Batch landscape/portrait outputs succeed at60×40 and40×60; a30×20 source rejects a60px target without upscaling.
7. Queue choices/settings are frozen. Retry uses the original50px request after the live form becomes25px and edits change, and never repeats successful files.
8. Wrong native final/composition dimensions and corrupted/missing planner metadata fail before file write. Native-main validation independently rejects an encoded image with plausible but incorrect dimensions.
9. Cancel and pagehide suppress a late native result. A changed source cannot retry the stale queue snapshot.
10. Text envelopes bind pre-resize composition dimensions, request/revision, source hash, text-recipe hash and original/working mode. Final-size-only overlays are rejected.
11. Original text basis5000×80 and explicit working basis4096×66 remain independent of a150px final request. Working processing and final resample are separately reported.
12. The Canvas adapter runs after composition, uses high-quality smoothing, preserves neutral canvas identity, allocates a separate output and releases aborted output. Its app fallback path encodes the planned final dimensions.

## Evidence and inspection

- [Contact sheet](../quality/export-size-qa/contact.png): actually opened with the image inspection tool. Also opened the actual final native PNG. Title/subtitle stay legible and aligned; padding and lower-padding text are retained. The PNG alpha boundary has no magenta contamination; the JPEG background is white.
- [Native final PNG](../quality/export-size-qa/final-native.png), [full native composition](../quality/export-size-qa/composition-native.png), [source](../quality/export-size-qa/source.png), [incorrect relayout control](../quality/export-size-qa/incorrect-relayout-control.png).
- [Native pixel report](../quality/export-size-qa/native-evidence.json), [alpha report](../quality/export-size-qa/alpha-evidence.json), [code/evidence hashes and scope](../quality/export-size-qa/verification.json).
- [Independent log](../quality/export-size-qa/independent-suite.log), [focused83-test log](../quality/export-size-qa/focused-suite.log).

QA evidence lives under quality/export-size-qa, outside packaged src/assets. The app staging allowlist was inspected: quality and tests are not copied into the Windows app.

## Boundary of the evidence

The DOM/IPC shell is authored test code, not a running Electron browser. The shipped app.js executes unchanged; text rendering is the real shipped renderer on installed Linux NativeCanvas0.1.100 and existing fonts. The non-text preview pipeline is an explicit adapter to the shipped pixel core. Final native PNG/JPEG files are produced by the actual isolated Sharp0.35.5 worker, decoded and compared.

The sequencing oracle uses the same installed Sharp Lanczos3 implementation in a separate operation, not an independently implemented resampling kernel. This proves ordering and decoded-pixel parity, not cross-platform font/codec parity. No browser rendering, native dialogs, actual filesystem commits by the desktop app, Windows runtime or installer acceptance are claimed. No denied browser route was retried; no local socket/server workaround, new installation/font/model, external API or private photo was used.

## Reproduce

`node --test tests/export-size-independent.test.cjs`

`node --test tests/export-size-independent.test.cjs tests/export-size-core.test.cjs tests/export-size-native.test.cjs tests/export-resize-canvas.test.cjs tests/text-export-native.test.cjs tests/text-export-contract.test.cjs tests/export-queue.test.cjs tests/export-renderer.test.cjs`
