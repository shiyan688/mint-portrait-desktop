# Unreleased desktop integration state, 2026-10-21

This checkpoint is an executable process/IPC foundation, not completed retouching quality or a new Setup release. The user selected personal use and a local-first/optional-API architecture. Separate approval to download and execute SegFace/BiRefNet author code and weights is pending; no permission is inferred from this document or a configuration flag.

## What actually works and was checked

- `main.cjs` and `preload.cjs` expose exact-origin local model probe, parsing and cancellation IPC. The renderer cannot supply executable paths, modules, commands, model roots, credentials or approval flags.
- `desktop-ai.cjs` derives a fixed Python/worker location from application roots, forwards only bounded model/device/face-selection fields, suppresses cancelled late results, and disposes the backend on application exit.
- `desktop-backend.cjs` and `backend/worker.py` use bounded framed stdin/stdout, with no local network listener and no temporary photo files. The process lifecycle tests exercise real authored fixture subprocesses on Linux, not just mocked promises.
- The model/device dialog calls the actual runtime probe and displays exact model version, weight hash, license-review metadata, missing/disabled status and CPU/CUDA availability. It does not run inference or silently replace the existing editing path.
- A real probe through the main-process wrapper, framed worker and installed official runtime passed: CPython 3.12.14, torch 2.14.1+cpu, torchvision 0.29.1+cpu; CPU available, CUDA unavailable. The current catalog has no ready model. `checkpoints/desktop-local-runtime-probe.json` records the result.
- Independent rerun: 272 Node tests passed, including 21 real fixture subprocess tests, 27 mock generative-adapter tests, six SegFace Node tests with nine nested stdlib Python tests, and nine bridge/panel tests. Separately, 17 BiRefNet stdlib tests passed. No count is evidence that a research model ran or produced acceptable pixels.

## What is deliberately not enabled

SegFace and BiRefNet wrappers have no acquired/loaded research weights and remain disabled. The current editing sliders still use the documented mitigation baseline. A skin parser is not a learned retouching model. BeautyGRPO requires a separate gated-base-model/usage decision and a feasible measured runtime; ModelScope remains an optional older comparison, not a substitute falsely labelled SOTA.

OpenAI/Alibaba image-editing adapters are disabled and not attached to UI actions. They have only mock-provider tests. They require trusted per-request upload/cost confirmation bound to exact photo revision, payload digest, provider and model before any eventual real request. No credentials have been read or configured, no photo has been uploaded, and no API fee was incurred. Provider adapters do not enforce a hard monetary cap.

The new parsing boundary preserves original-ROI dimensions and provenance, but the legacy photo decode/export path still has its documented 4096-edge/16MP limit. No claim that full-resolution end-to-end model editing is integrated is justified yet. Full-image history, model-result acceptance, learned-skin-mask application and export must be connected and visually tested after model execution approval.

## Packaging and verification limits

No new installer was built. The existing 0.1.1 directory validation fix remains intact. Python worker/adapters/runtime must be staged as explicit resources outside ASAR in a future model-enabled build; accidental packaging of the development virtualenv, caches and model directories is excluded. This source checkpoint is not an installation package.

There was no native Windows launch, install/uninstall, CUDA/RTX 4060 benchmark, browser screenshot/real layout test, research-model inference, ONNX export or TypeScript compiler pass in this phase. Legacy browser test code no longer requests disabling Chromium's sandbox or unsafe software rendering; no restricted browser workaround was attempted.

## Next gated milestone

After specific approval: acquire only the exact pinned SegFace MobileNet and BiRefNet assets, review/verify source and hashes, execute only on the public licensed QA portraits, inspect full-size mask/edge results and failures, then integrate accepted learned outputs. Keep API/private-photo/gated-term actions separately disabled unless explicitly authorized. Do not release a new Setup until genuine image QA and the actual packaged-resource checks pass, with Windows testing limitations disclosed.
