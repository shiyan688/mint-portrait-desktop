# Learned portrait integration checkpoint

2026-10-21. **Unreleased candidate source, not a completed product or Setup.exe.** Published installer 0.1.1 is not replaced by this work. The user-requested broader PixelCake/Xingtu feature coverage and dedicated learned retouching remain open.

## What actually ran

- SegFace MobileNet/CelebAMask-HQ, author code revision `9416628e7b5a3e4b9a1068b8467bdc0cf0be7a7d`, pinned 84,928,824-byte checkpoint SHA-256 `4d67ea7d8c33849272b293b421fa3d20d54d9987f1bca8c1ef0eebe4534993e8`. Restricted `weights_only=True`, strict state dictionary, no extra backbone download. Three publicly licensed NASA fixture crops passed actual CPU inference and visual partition review. These are **face-parsing results, not retouched portraits**.
- Suni also passed the real application `desktop-ai` → Node framed stdio → isolated Python → approved SegFace path. Its original 471×612 ROI was preserved, source bytes unchanged, compact masks exactly matched the separately saved inference. Cold wall time was about 13.8 seconds including runtime/probe/hash/load. The model-only warm timings in the separate QA report are not equivalent to application latency.
- BiRefNet HR-matting pinned HF revision `5d6b6f8adcb5b417c871b1d84ceaae9871355b7f`, weights SHA-256 `a5a4de698739ea5e0e8bbab28e1b293dde95092b87a442d566cbc585c53cef55`. Actual CPU 2048 mixed-BF16 inference completed for Suni, and the real Node bridge completed Pettit at exact 1920×1280 output in about 116 seconds. Eileen also passed the bridge with optional foreground estimation in about 114 seconds; Victor completed the final alpha-only HR control in about 111 seconds. Victor retained the blue-clothing silhouette with a relatively clean bald-head edge, but does not test dense hair. Peak observed child memory for the final HR run was about 7 GiB. The CPU deformable-convolution operator explicitly stays float32; execution provenance records this. Float32 HR previously exited by SIGKILL; OOM was suspected but not proven. CPU/CUDA fallback is not automatic.
- **BiRefNet visual quality is not accepted for release.** Suni has incorrect removal of white garment and fringe haze. A successful tensor/transport run is not an alpha-quality benchmark. These NASA fixtures have no reference alpha, so no fake SAD/MSE or SOTA ranking is reported.
- Optional PyMatting 1.1.16 foreground-color estimation was evaluated separately on saved real alpha, with original source and alpha retained. It can reduce color contamination but cannot repair an erroneous foreground selection. It is classical postprocessing, not a new learned/SOTA model. Its default is off.

Primary project sources: [SegFace](https://github.com/Kartik-3004/SegFace), [SegFace weights](https://huggingface.co/kartiknarayan/SegFace), [BiRefNet](https://github.com/ZhengPeng7/BiRefNet), [BiRefNet HR-matting](https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting), [PyMatting](https://pymatting.github.io/foreground.html).

## Implemented application path

- Native IPC exposes only whitelisted model IDs, explicit device, source pixels and original-pixel ROI. No renderer-supplied executable, asset path, approval flag, credential or URL.
- A real original-size decoder rejects original images above the current 4096-long-edge/16-MP bounds before creating a resized image. This is an explicit limitation, not a full-resolution/RAW solution. The 1280-pixel preview never pretends to be the original.
- SegFace requires an explicitly selected detected face. It returns conservative **skin + nose** weights, protects other categories/boundaries/uncertainty, and displays an explicitly labelled diagnostic overlay over the original source. It has no beard category. Deterministic boundary margins are not claimed to be another AI model.
- UI has explicit parser/matte/device selection, indeterminate elapsed status, cancellation, stale-result rejection, source-revision-bound caches, an explicit alpha enable switch, undo/redo and full-original export using the same cached matte. Missing/stale learned masks fail closed instead of silently using legacy segmentation.
- Manual keep/remove mask brush stores bounded original-coordinate polylines in settings/history, not mutated model outputs. Each stroke unions its segment coverage before applying opacity. Preview is resampled from corrected original alpha; export uses corrected original alpha. Raw-model inspection does not alter export state. Stroke edits and cache IDs never copy to a different photograph.
- Learned alpha color composites use linear-light interpolation, without legacy confidence dilation/feathering. Transparent export keeps partial-alpha colors and sanitizes hidden RGB only when the final exported alpha byte is zero. Original input pixels and model caches remain unchanged.
- Optional foreground RGB has a separately declared contract/provenance, not a retouch result. Refinement derived from an earlier alpha must not be reused silently after manual mask correction. This optional feature is not yet a fully integrated end-user control.

## Verification and blockers

Actual pixel/inference images and detailed provenance are under `quality/segface/` and `quality/matting/`. Public NASA imagery is factual software QA only, not endorsement or promotional artwork. No user photograph was sent to any service.

`tests/learned-ui.test.cjs` executes actual application functions with authored DOM/canvas/IPC doubles. It verifies original-coordinate requests, stale/cancel lifecycle, cache identity, mask brush undo and export, but is not native browser verification. Pixel tests run the actual deterministic JS engine; Python/Node reports separately identify real model runs.

Normal Chromium launch failed inside the process with `process_singleton_posix.cc:297`, `socket() failed: Operation not permitted (1)` and `SIGABRT`. It was an environment runtime failure, not a successfully tested UI. No sandbox or socket restriction was bypassed. Windows install/uninstall, Electron native display, pointer delivery, CUDA and RTX 4060 performance are untested.

The restored source archive intentionally has no compiled `installer/payload` tree. Two packaging-inventory tests therefore cannot pass until a real new payload is built. Do not replace that evidence with placeholders, weaken installer tests, or advertise the candidate as a finished installer.

## Next bounded work

1. Complete visual acceptance of alpha plus explicitly optional foreground color estimation, including garments, fine hair, occlusions and transparent objects. Add original-source mask correction to the acceptance cases.
2. Evaluate a dedicated trained retouch/blemish model behind the existing immutable original-ROI contract. SegFace is not that model. New gated agreements or unapproved research execution still require a separate decision; API support remains disabled and no photo upload or charge is authorized.
3. Replace the 4096/16-MP, 8-bit canvas working limit with a real original document/tiled/color-managed backend before claiming professional export parity. Manual self-contained project persistence is now implemented in the later bounded milestone (see `PROJECT-FORMAT.md` and `PROJECT-UI-QA.md`); layered document editing remains open. Then expand the independently audited product-coverage backlog.
4. Build and validate an explicit optional model/runtime package and Windows installer only after quality gates. Preserve the 0.1.1 path validation/uninstall safeguards and unsigned disclosure.

## Final bounded test outcome

The full Node suite ran 384 tests: 382 passed and the two documented missing installer-payload checks failed. A source-only rerun explicitly excluded those two named artifact checks and passed all 382 selected tests. All 30 Python adapter unit tests passed. See `checkpoints/final-validation.json` and the complete logs; these do not convert mocked UI checks into native Windows/browser acceptance.
