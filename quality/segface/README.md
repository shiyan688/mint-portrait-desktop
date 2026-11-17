# SegFace MobileNet: actual CPU parsing and conservative-mask QA

Completed 2026-10-21 after explicit approval to run SegFace on public fixtures. This validates a learned parsing module on three portraits, not all app algorithms, identity-safe beautification, general segmentation accuracy, Windows support or RTX 4060 performance.

## What actually ran

- Official MobileNet CelebAMask-HQ 512 checkpoint: 84,928,824 bytes, SHA-256 `4d67ea7d8c33849272b293b421fa3d20d54d9987f1bca8c1ef0eebe4534993e8`.
- Code revision `9416628e7b5a3e4b9a1068b8467bdc0cf0be7a7d`; only the exact-hash Celeb network and transformer modules. Restricted `torch.load(weights_only=True)` and strict `state_dict_backbone` loading both succeeded. No unrestricted pickle fallback, automatic pretrained-backbone download, paid API, private portrait or GPU inference.
- Python 3.12.14, torch 2.14.1+cpu, torchvision 0.29.1+cpu, numpy 2.5.2, Pillow 12.3.0. Two intra-op CPU threads, one inter-op thread. Peak Linux process RSS: 767,268 KiB (about 749 MiB).
- Saved NASA fixture PNG/raw-RGBA hashes and existing local MediaPipe landmark-image hashes were checked before cropping. Selected-face ROI coordinates refer to the original fixture pixels, not model-resolution coordinates.

| Public fixture | Exact output ROI dimensions | Adapter elapsed time |
|---|---:|---:|
| Victor Glover | 646 × 783 | 1.89 s, including cold model construction/load |
| Sunita Williams | 471 × 612 | 1.11 s, warm model |
| Eileen Collins | 542 × 665 | 1.23 s, warm model |

Times exclude Python/Torch startup, downloads and visual rendering. They were measured in a shared cloud CPU environment; other testing may have overlapped. They are observations, not an isolated benchmark or a supported-device promise.

Every output has 19 finite, normalized probability planes at the exact ROI dimensions. Maximum per-pixel probability-sum error across the three outputs is 5.96e-7. Input bytes remained unchanged. `report.json` and each `result.json` record source credits, hashes, crop selection and inference provenance.

## Visual review

`contact-sheet.jpg` shows original ROI, learned labels, class-2 skin probability and protected eye/lip/hair diagnostics. Both the implementation worker and parent independently inspected this sheet; additional full-size overlays were inspected. These frontal images show coherent skin/nose/eye/brow/lip/hair partitions. No reference segmentation labels were supplied, so this is not an F1/IoU measurement.

Important limitations:

- SegFace's `skin` is class 2; `nose` is class 10. The first diagnostic skin overlay intentionally excludes nose. The product candidate mask uses the explicit union `skin + nose` instead.
- Beard and moustache have no separate class. Parsing alone cannot guarantee facial-hair protection.
- Thin eyelashes, lip edges, hair wisps, occlusion, strong pose and small faces need broader testing. Semantic hair segmentation is not a fine-alpha matting result.
- Three frontal NASA portraits do not establish generality across lighting, complexion, cosmetics, glasses, expressions or multiple-face cases.

## Conservative candidate mask, not a retouch algorithm

`makeConservativeSkinMasks(result, options)` operates only on already computed probabilities. It preserves original ROI geometry and returns complementary `skin`/`protected` Float32Arrays plus explicit policy metadata:

1. Sum model classes skin and nose.
2. Apply an O(pixels) square minimum filter, treating outside the ROI as fully protected. Default guard radius is `round(min(width,height)/160)`, clamped to 2–12 original pixels; explicit host overrides are limited to 1–32.
3. Apply a smooth confidence ramp from 0.65 to 0.95, capped by the guarded probability. This can only remove candidate coverage, never invent extra safe skin.
4. Return protection as one minus the candidate mask, including other semantic classes, uncertain areas and the boundary margin.

`conservative-contact-sheet.jpg` compares raw skin+nose, the guarded candidate and removed boundary/uncertainty regions. It visibly expands protection around eyes, brows, mouth and the face/hair boundary. This deterministic postprocessing is not described as learned or SOTA. It cannot fix confident model misclassification. No skin retouch effect has been applied in these images.

The three default radii were 4/3/3 pixels. Saved-output checks found zero pixels whose conservative probability exceeded the raw allowed probability. Skin/protection complement error was at most 2.99e-8. Confidence-above-0.5 coverage decreased from 220,882→199,273, 85,176→73,977, and 91,937→79,888 pixels respectively. `conservative-mask-report.json` records exact policy and results. Computing these masks did not run the model again.

## Checks and handoff

- `tests/segface-adapter.test.cjs`: explicit wire/typed-array formats, class sums, malformed data, conservative neighborhoods and naive-reference agreement.
- `tests/segface-synthetic.py`: stdlib-only safety tests, including restricted-loader failure without fallback and bounded CPU-thread configuration.
- `preprocess-parity.json`: four synthetic input geometries were bit-identical to the official torchvision/PIL preprocessing recipe.
- `real-output-mask-validation.json`: saved actual output decoding and skin+nose/other-class union checks.
- `catalog-reference.json`: exact app-owned manifest data with three hashed assets, sourceDir, ROI policy and approved execution flag. Rebuild paths in the privileged catalogue for portability; never treat a renderer/user-supplied JSON file as permission.

Parent owns service/IPC/UI integration and release decisions. ONNX, WebGPU, Windows/CUDA, stress/cancellation and broad portrait-quality qualification remain separate. The original research/integration planning documents predate this run; this directory records the actual execution checkpoint.

## Public image use

Sources and usage notes are copied into `report.json` from the existing fixture manifest. NASA images are used for noncommercial factual software-testing illustration, not promotion or endorsement. Overlays are diagnostic software outputs, not original NASA photographs. Preserve the credits and do not ship these portraits as product assets.
