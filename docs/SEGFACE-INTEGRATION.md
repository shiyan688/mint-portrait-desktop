# SegFace integration: pinned, gated, not yet inferred

Status checked 2026-10-21: own adapter and export harness written; synthetic-only tests passed. No SegFace checkpoint was downloaded or loaded, no upstream module executed, no portrait inferred, no ONNX exported, and no WebGPU or Windows GPU performance measured by this worker. The separate research report explains why this is a practical candidate, not a claim that every app algorithm is SOTA.

## Exact assets for bounded execution approval

| Asset | Pinned revision | Bytes | SHA-256 |
|---|---|---:|---|
| Official source | `9416628e7b5a3e4b9a1068b8467bdc0cf0be7a7d` | Selected files below | Per-file manifest |
| MobileNet CelebA 512 checkpoint | HF `5e093b03c0523f7f32a9845bbbc75ecb027c8bee` | 84,928,824 | `4d67ea7d8c33849272b293b421fa3d20d54d9987f1bca8c1ef0eebe4534993e8` |
| Swin-B CelebA 512 checkpoint | Same HF revision | 1,093,095,540 | `320b1c167191804913323b229a5256b1fc71f1987161fc54dc440e59af45dae8` |

Checkpoint paths are `mobilenet_celeba_512/model_299.pt` and `swinb_celeba_512/model_299.pt`. Both last changed in upload commit `7c6077ee6b09c0ea63ac15c5b4184db52637da78`. The immutable HF revision above also includes the MIT model card. Metadata was read from the [official HF API](https://huggingface.co/api/models/kartiknarayan/SegFace) and the [MobileNet](https://huggingface.co/api/models/kartiknarayan/SegFace/tree/main/mobilenet_celeba_512) / [Swin-B](https://huggingface.co/api/models/kartiknarayan/SegFace/tree/main/swinb_celeba_512) file metadata. The SHA-256 is the large-file content digest, not the Xet hash or Git object ID.

The [source commit](https://github.com/Kartik-3004/SegFace/commit/9416628e7b5a3e4b9a1068b8467bdc0cf0be7a7d) and [weight card](https://huggingface.co/kartiknarayan/SegFace) declare MIT. Preserve source/license notices. The transformer file retains Meta copyright and an upstream-license header; audit and preserve upstream notices before distribution. This is not blanket legal clearance for third-party training datasets.

### Only two upstream modules are needed

1. `network/models/segface_celeb.py`: 14,602 bytes, SHA-256 `9258ad3e8f102dfb4d0cbbd4bc41b83f5eeaa011a79c71c001355b3d107f33c4`.
2. `network/models/transformer.py`: 9,587 bytes, SHA-256 `df8ac36e5bd9d367837efc3012b9c2e675b75ab6983a2ea25e2a85dba6d0b237`.

These were read as text from the pinned official revision and hashed without execution. The adapter compiles only matching bytes after host approval. It does not import the upstream package initializer, training script, dataset loader, or evaluation script. A narrow AST transformation removes the Celeb file's two local wildcard imports and `sys.path.insert`, injects only the required transformer classes, and replaces exactly ten pretrained backbone initializers with `weights=None`. Source structure drift fails closed. This avoids the upstream constructor's otherwise automatic ImageNet-weight download. Strict loading must then restore the complete trained parameter/buffer state. No inference equivalence has yet been tested.

## Dependency/runtime route

Start with Python CPU. Installed package metadata in the shared `backend/.venv` reads: torch `2.14.1+cpu`, torchvision `0.29.1+cpu`, numpy `2.5.2`, Pillow `12.3.0`. These versions are present, not yet validated with SegFace. No second environment was created. The author's original Linux environment pins torch 2.0.1 / torchvision 0.15.2 and many training dependencies; it is not a Windows deployment recipe or a recommendation to install old packages. [Original environment](https://github.com/Kartik-3004/SegFace/blob/9416628e7b5a3e4b9a1068b8467bdc0cf0be7a7d/environment.yml).

The independent inference wrapper needs only torch, torchvision, numpy and Pillow. It does not need OpenCV, timm, dataloaders, a dataset download, dotenv, NCCL, or a network listener. After CPU verification, repeat on explicitly selected CUDA and measure the actual RTX 4060. Never label the CPU experiment a GPU test.

The optional ONNX export harness additionally needs official ONNX and ONNX Runtime packages. It exports a fixed `1×3×512×512` input and `1×19×512×512` logits at opset 17, then checks the graph and compares two synthetic fixtures against PyTorch. It requires max absolute error ≤0.0005 and mean absolute error ≤0.00001, recording argmax agreement. Successful export alone is insufficient. WebGPU requires a separate provider/operator/parity and memory test; no browser backend exists in this checkpoint. Prefer this staged path to embedding Python checkpoint loading inside Electron renderer code.

## Input, output and coordinate semantics

Official Celeb preprocessing is RGB, PIL bicubic resize to 512 square, division by 255, CHW, and ImageNet normalization: mean `[0.485, 0.456, 0.406]`, standard deviation `[0.229, 0.224, 0.225]`. It is not the LaPa ROI-tanh path. The crop policy is part of product integration: this adapter requires an explicit detected-face or user-face-ROI selection rather than silently treating a whole photograph as a face. [Official loader](https://github.com/Kartik-3004/SegFace/blob/9416628e7b5a3e4b9a1068b8467bdc0cf0be7a7d/datasets/celebamask_hq.py).

The service supplies original-pixel ROI dimensions, exact opaque RGBA8 crop bytes, original image size, and selection `{kind: detected-face | user-face-roi, faceId, revision}`. Metadata is not proof a detector actually ran; the host must populate it from real local detection or explicit user input. No user/private photos are uploaded. Non-opaque inputs are currently rejected instead of guessing how hidden RGB should influence parsing. The maximum ROI is 1,048,576 pixels, bounding the 19-plane payload to 79,691,776 bytes. Unsupported larger crops fail clearly rather than silently changing output resolution.

Output logits are bilinearly resized with `align_corners=False` to the exact ROI dimensions before channel softmax. This matches the author's 512-square postprocessing at the reference resolution; extension to arbitrary ROI geometry still needs parity/visual QA. The returned probabilities are little-endian float32, planar channel-major, with nineteen explicit classes. No original image byte is edited by parsing.

Class order: background, neck, skin, cloth, l_ear, r_ear, l_brow, r_brow, l_eye, r_eye, nose, mouth, l_lip, u_lip, hair, eye_g, hat, ear_r, neck_l. Skin is index 2, hair 14, glasses 15. Preserve the upstream suffix labels rather than guessing anatomical left/right conventions. [Official evaluation class mapping](https://github.com/Kartik-3004/SegFace/blob/9416628e7b5a3e4b9a1068b8467bdc0cf0be7a7d/inference.py).

## Host contract and safety

- Module `adapters.segface` exports `probe(manifest)`, `infer(request)` and `close()`.
- `probe` uses stdlib metadata only, never imports torch or parses model bytes, and reports `not_validated`, not readiness or quality.
- Host manifest must be explicitly enabled with `config.executionApproved=true` only after actual user approval. The Boolean is a fail-closed application guard, not permission by itself. The parent owns this approval and the service/IPC/catalog integration.
- `assets.checkpoint` names the exact file; `config.sourceDir` names a read-only pinned source root under the host's model root. Host manifests must hash both executable source files as assets. The adapter independently checks their exact bytes immediately before compilation.
- Descriptor `weightsSha256` must match the chosen variant. Device must explicitly be CPU or CUDA; there is no implicit device/model fallback.
- The `.pt` is not a safetensors file. Loading is strictly `torch.load(..., map_location='cpu', weights_only=True)`, followed by validation of `state_dict_backbone` as a nonempty string-to-tensor mapping and `load_state_dict(..., strict=True)`. Unknown globals, missing keys or mismatched shapes fail. There is no unrestricted-pickle retry or `trust_remote_code`.
- Inference is serialized because upstream feature hooks mutate state. Actual cancellation requires the supervising service to terminate the worker; checking an AbortSignal alone cannot interrupt a blocking torch call. The adapter has no autonomous network or asset acquisition path.
- Worker provenance must echo the job/model/version/digest/device and selection. Class-mask helpers add explicit class IDs/names but are not a replacement for worker provenance.

## Own files and verification

- `backend/adapters/segface/manifest.json`: pinned asset/source facts, no approval or ready claim.
- `backend/adapters/segface/adapter.py` and `__init__.py`: gated Python parsing interface.
- `backend/adapters/segface/mask.cjs`: strict float32LE decode, explicit class union masks, clearly labeled colorized class-map preview.
- `backend/adapters/segface/export_onnx.py`: opt-in offline exporter with mandatory synthetic parity; not executed.
- `tests/segface-adapter.test.cjs`, `tests/segface-synthetic.py`: six Node tests, including nine stdlib Python tests. These use generated bytes/test doubles, not learned inference.

Run `node --test tests/segface-adapter.test.cjs`. Current focused suite passes. Python adapter/export source was syntax-checked with AST parsing, not executed against research assets. Full aggregate release checks remain the parent task's responsibility after integration.

Before enabling a released feature: obtain execution approval; acquire only pinned assets; verify checksums; pass restricted load; compare source/portable preprocessing and output; run public-authorized portrait fixtures; review per-class and boundary quality; verify stale/cancel behavior; measure CPU and actual Windows CUDA resource use; perform package/license review. Keep the catalog disabled until these facts exist. Synthetic tests do not establish F1, identity preservation, SOTA status, hardware support, or acceptable portrait quality.
