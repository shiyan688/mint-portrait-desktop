# Desktop portrait editor audit

Date: 2026-10-21. Scope: current Electron source, local image pipeline, UI state transitions, and local export boundaries.

## Result

79 Node tests passed, 0 failed, 0 skipped. Syntax checks passed for app.js, pipeline.js, pixel-worker.js, main.cjs, and preload.cjs. Six audit test files add 62 deterministic checks, including 34 synthetic pixel-operation checks reused against the desktop engine.

This is not a native Windows or real-browser acceptance pass. No claim is made that model inference, custom-protocol loading, visual layout, or native dialogs were exercised in Electron.

## Defects found and corrected

1. Export dimensions were inconsistent: the UI advertised a 16,000,000-pixel cap, while decoding allowed 16,777,216 pixels. Both now use the exact 16,000,000-pixel cap. The UI also applies the same post-rounding height clamp as the decoder, including the 4021 × 3980 boundary case. References: src/app.js:222; src/pipeline.js:29,120–122. Regression test passes.
2. Repeated import requests could open multiple pending native choosers, and a later result could be silently ignored while the first import was processing. Renderer and main-process reentry guards now prevent this. References: src/app.js:15,21,320–329; main.cjs importDialogActive guard. Renderer regression test passes.
3. The renderer's beforeunload veto could conflict with a confirmed native close. The renderer warning is now browser-only; native dirty state tracks unsaved settings and active export. Successful native exports clear the corresponding dirty snapshot; failed exports do not. References: src/app.js:36–41,428–435,562; main.cjs close handler. Regression tests pass. Native dialog presentation itself remains untested.
4. Corrected malformed option markup and changed healing help text from surrounding “texture” to surrounding “color,” consistent with the implemented color-plane repair algorithm.

## Verified coverage

- Immutable source pixel operations, alpha preservation, landmark-gated beauty/reshape, confidence-mask compositing, malformed inputs, and bounded geometry.
- Maximum two simultaneous pixel workers, queued/running cancellation, no allocation for canceled queued jobs, settings snapshots, late-result suppression, and recovery after worker failure.
- UI stale render/decode suppression, cancellation while choosing a folder or encoding, no filesystem write after those cancellations, repeated-submit protection, export failure unlock, undo/redo, and native dirty-state transitions.
- Untrusted IPC windows/subframes rejected; unexpected permissions denied; external URL schemes rejected by the configured request handler. These are source/handler tests, not a live network traffic capture.
- Import file/count/aggregate limits, local asset paths, unique HTML IDs, local script/style references, and matching hashes for all bundled model/WASM assets.
- Actual filesystem tests: 20 concurrent same-name exports retain the original file and create distinct new files using exclusive creation. Invalid encoded bytes leave no file behind.

## Not verified

- Browser execution and actual MediaPipe inference: browser startup was blocked before page loading by the execution environment's socket/sandbox restrictions. No alternate machine was used.
- Native Windows startup, custom mint:// protocol behavior, CSP enforcement, WASM initialization, image decoding/orientation, canvas encoding, actual native open/save dialogs, installed-GPU behavior, and visual responsiveness.
- The final rebuilt distribution archive: packaging is performed after this source audit and needs its own artifact integrity check.
- Human-perceived portrait quality or professional color fidelity. Synthetic pixel tests are not quality or model-accuracy benchmarks.

The provided browser integration test remains runnable on a permitted desktop, but it is not a substitute for a Windows native acceptance test. Before calling the application release-ready, run the packaged app and verify import, real inference, rapid adjustment/switching, cancel/retry export, duplicate filenames, and confirmed close on Windows.

## Reproduce

Run npm test for the complete Node suite. The audit tests are tests/audit-assets.test.cjs, tests/audit-engine.test.cjs, tests/audit-export.test.cjs, tests/audit-main.test.cjs, tests/audit-pipeline.test.cjs, and tests/audit-ui.test.cjs.
