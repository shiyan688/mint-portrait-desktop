# Identity-preserving reshaping: evidence and deployment audit

Checked: 2026-10-21. Scope: offline Windows portrait retouching on an RTX 4060 whose VRAM has not been measured. This was a read-only review of author papers, repositories and model cards. No model was downloaded or run, no third-party code was executed, and no photo was uploaded. Numbers below are authors' reports, not measurements of MintPortrait.

## Decision

1. **Best directly relevant research candidate: MirrorPPR-Face**, with a distinct, disabled exemplar-retouch adapter. It is not presently cleared for distribution or proven feasible on this computer. MirrorPPR-Pro is stronger broad-portrait evidence, but a public Pro checkpoint was not found in the inspected official releases.
2. **First practical parsing candidate: SegFace**, because both the code and official weights carry explicit MIT declarations. Compare its high-quality Swin-B and lightweight MobileNet variants locally. Do not call it the universally best parser: the comparison regime matters, and pretrained FaRL reports higher aggregate scores.
3. **Alignment candidates: FaRL/facer and SPIGA**, pending explicit resolution of pretrained-weight rights. These are useful released baselines, not a justified claim of October 2026 SOTA. Recent dynamic-landmark research belongs on a watchlist until checkpoints, rights and reproducible inference exist.
4. **Ship-capable geometry work now is infrastructure and an honestly named deterministic fallback**: protected-region masks, semantic controls, coordinate transforms, robust inverse deformation, cancellation and validation. The existing MediaPipe 478-point/elliptical warp is not transformed into SOTA by a new label or adapter interface.

## 1. MirrorPPR: task-matched evidence, with important limits

The ECCV 2026 project transfers a before/after example's retouch to another portrait. This is more directly relevant than general text-image editing rankings. Its MAE/RFormer representation conditions Qwen-Image-Edit-2511 through a connector and LoRA. This is exemplar transfer, not a native numeric slider model. [Official project](https://sjtu-deng-lab.github.io/MirrorPPR/).

| Author benchmark | Model | PSNR ↑ | SSIM ↑ | LPIPS ↓ | Face similarity ↑ |
|---|---|---:|---:|---:|---:|
| SimFace-100 | MirrorPPR-Face | 32.25 | 0.909 | 0.186 | 0.937 |
| SimFace-100 | NanoBanana2, text | 24.25 | 0.860 | 0.239 | 0.601 |
| ProPortrait-500 | MirrorPPR-Pro | 32.65 | 0.927 | 0.200 | 0.960 |
| ProPortrait-500 | NanoBanana2, text | 27.45 | 0.904 | 0.183 | 0.667 |

These support a strong task-specific result, not superiority on every metric: NanoBanana2 has lower LPIPS in the Pro comparison. [Project results](https://sjtu-deng-lab.github.io/MirrorPPR/).

The evaluation uses 12 source faces/100 operation combinations for SimFace and 40 portraits/500 combinations for Pro. They are author-created benchmarks, not independent large-scale identity verification. Face similarity is ArcFace cosine similarity against the retouched ground truth, not directly against the unedited original. SimFace uses 1024-square inputs; Pro is approximately 1.5K-square image area. Inference uses 40 steps. The simulated training subset starts from FFHQ; the professional subset derives from PPR10k with commercial retouch operations. Distribution terms for datasets require their own audit. The appendix's MediaPipe/MLS warping is a training-data construction baseline, not the learned MirrorPPR inference algorithm. [Paper and protocol](https://arxiv.org/html/2606.29308v1).

### Actual release and blockers

- **Code:** [SJTU-DENG-Lab/MirrorPPR](https://github.com/SJTU-DENG-Lab/MirrorPPR). No explicit code license was found in the inspected root/metadata. The paper's CC BY-NC-SA license is not a license grant for software or weights.
- **Weights:** [MirrorPPR-Face tree](https://huggingface.co/SJTU-DENG-Lab/MirrorPPR-Face/tree/main) exists and reports **59.7 GB** total. Its [task-specific folder](https://huggingface.co/SJTU-DENG-Lab/MirrorPPR-Face/tree/main/mirrorppr_face) reports **2.01 GB**, covering connector, LoRA, MAE and RFormer; the base components account for the remainder. No explicit adapter weight license appeared in the inspected model card. Download availability does not establish permission to redistribute or commercially deploy.
- **Base:** [Qwen-Image-Edit-2511](https://huggingface.co/Qwen/Qwen-Image-Edit-2511) declares Apache-2.0. That does not resolve MirrorPPR adapter rights.
- **Broader model:** the [official collection](https://huggingface.co/collections/SJTU-DENG-Lab/mirrorppr) exposed Face, data and paper, not a verified MirrorPPR-Pro checkpoint. Do not advertise Pro as installed.
- **Runtime:** the [official inference entry point](https://raw.githubusercontent.com/SJTU-DENG-Lab/MirrorPPR/main/mirrorppr/inference/simface100.py) loads BF16 CUDA components. Its multi-GPU option shards independent examples; it is not evidence that one image needs eight GPUs. No supported quantization/offload recipe, minimum VRAM or RTX 4060 latency was verified in that entry point. Disk size is not peak VRAM, but a 59.7 GB release plainly cannot justify promising an unmodified full-resident run on this unmeasured device.
- **Windows:** [environment.yml](https://github.com/SJTU-DENG-Lab/MirrorPPR/blob/main/environment.yml) pins Python 3.12, PyTorch 2.9.1 and a substantial modern diffusion stack. Linux-oriented dependencies and multiple OpenCV distributions need a clean Windows dependency audit. No Windows validation was established.

**Disposition:** architecture stub only until licenses, permitted use, verified artifact hashes and measured runtime feasibility are resolved. Personal use does not automatically cure a missing license. CPU offload/quantization might improve feasibility, but that is an untested engineering hypothesis and must undergo quality regression. A hosted API would separately change offline/privacy scope and needs the user's decision.

## 2. Precise parsing: SegFace first, FaRL as quality challenger

### SegFace, AAAI 2025

SegFace's class-specific decoder targets small/rare facial classes, including accessories. The 512-pixel Swin configuration reports CelebAMask-HQ mean F1 **88.96**, mean IoU **81.55**; LaPa mean F1 **93.03**, IoU **88.14**. Its 7.034M-parameter MobileNetV3 variant reports F1 **87.91**, IoU **79.98**, versus 91.006M parameters for Swin. Reported speeds are 95.96/38.95 FPS respectively, but benchmark hardware was not established in the inspected text; these are not RTX 4060 promises. Helen F1 is 91.8 versus DML-CSR's 93.8. Table 1's FaRL comparator is explicitly trained from scratch, not the strongest pretrained release. [Paper](https://arxiv.org/html/2412.08647v1).

Source code has an [MIT license](https://github.com/Kartik-3004/SegFace/blob/main/LICENSE); the [official model card](https://huggingface.co/kartiknarayan/SegFace) separately labels the weights MIT. Real checkpoint paths include:

- `swinb_celeba_512/model_299.pt`
- `mobilenet_celeba_512/model_299.pt`
- `swinb_lapa_512/model_299.pt`

The CelebAMask-HQ class set is the more useful starting point for accessory protection. Use the author's exact crop, color, normalization and inverse-map conventions, not a generic square resize. Keep a pinned artifact manifest and MIT notices. Verify checkpoint contents with safe tensor loading; do not run untrusted pickle hooks. No official Windows/ONNX parity was verified. The MIT declarations are strong deployment evidence, not a blanket certification of every underlying dataset or third-party dependency.

### FaRL / facer

The official pretrained 64-epoch FaRL results report CelebAMask-HQ F1 **89.57**, LaPa F1 **94.04**, WFLW NME **3.88**, and 300W full NME **2.88**. Different pretraining means these are not a controlled SegFace head-to-head, but they prevent an honest universal SegFace-SOTA claim. [FaRL official results](https://github.com/FacePerceiver/FaRL).

[facer](https://github.com/FacePerceiver/facer) provides practical parsing/alignment runtimes and [MIT source code](https://github.com/FacePerceiver/facer/blob/main/LICENSE). Its source identifies real TorchScript releases, including:

- [LaPa parsing checkpoint](https://github.com/FacePerceiver/facer/releases/download/models-v1/face_parsing.farl.lapa.main_ema_136500_jit191.pt), referenced in [parser source](https://raw.githubusercontent.com/FacePerceiver/facer/main/facer/face_parsing/farl.py).
- [WFLW alignment checkpoint](https://github.com/FacePerceiver/facer/releases/download/models-v1/face_alignment.farl.wflw.main_ema_jit.pt), referenced in [alignment source](https://raw.githubusercontent.com/FacePerceiver/facer/main/facer/face_alignment/farl.py).

These URLs were verified in official source, not downloaded. A separate explicit pretrained-weight license was not established during this review. Clarify coverage before packaging commercially. Disable automatic network retrieval for offline operation. Preserve the official ROI/tanh transform and five-point alignment, and test TorchScript/export parity. Do not substitute unrelated MediaPipe index semantics.

## 3. Landmark and 3D alternatives

| Candidate | Evidence and release | Deployment conclusion |
|---|---|---|
| SPIGA, BMVC 2022 | WFLW NME 4.060, FR@10% 2.080; shape/pose-aware graph attention. [Official code](https://github.com/andresprados/SPIGA) is BSD-3-Clause; [official weights](https://huggingface.co/aprados/spiga/tree/main) include approximately 255 MB WFLW checkpoint. | Good shape-preserving baseline, not current SOTA. No explicit separate weight license or Windows test verified. |
| STAR, CVPR 2023 | WFLW NME 4.02, FR 2.32. [Official paper](https://arxiv.org/abs/2306.02763); [code](https://github.com/ZhenglinZhou/STAR) links weights. | Contour ambiguity is relevant; no adequate explicit release license established. Not a dense 478-point substitute by index. |
| PossLoss, ICCV 2025 | WFLW NME 4.07, FR 2.12; 300W full 2.84. [Official paper](https://openaccess.thecvf.com/content/ICCV2025/html/Zhu_PossLoss_A_Reliable_and_Sensitive_Facial_Landmark_Detection_Loss_Function_ICCV_2025_paper.html). | Newer does not dominate STAR on every metric. No deployable official checkpoint verified here. |
| Unified Dynamic FLD, 2026 | Face-part-relative queries permit variable landmark counts. Adapted ViT-B: WFLW NME 4.02/FR 2.19; 300W full 2.76. [Paper v2](https://arxiv.org/html/2608.10346v2). | Strong semantic-interface inspiration. No official code/checkpoint release found in inspected paper. A100 training hardware is not a minimum inference requirement. |
| FreqFLD, September 2026 | [Paper](https://arxiv.org/html/2609.10278v1): WFLW 4.50, 300W full 3.08; [code](https://github.com/jkj1059657014/FreqFLD) exists. | No public trained checkpoint or root license verified. Recency alone gives no accuracy advantage over released baselines. |
| FAHCD-Net, September 2026 | [Paper](https://arxiv.org/html/2609.16842v1), [Apache-2.0 source](https://github.com/HJWKryptonite/FAHCD-Net). | No trained checkpoint/deployment instructions verified in the inspected release. Research watchlist, not an installable replacement. |

NME values require the original dataset, split and normalization. Never compare 300W and WFLW NME as if they were one benchmark. More points do not establish higher accuracy, and missing occluded points must not be fabricated as confident observations.

**Dedicated geometric reshaping:** the public [DeepFaceReshaping repository](https://github.com/lastapple/DeepFaceReshaping) inspected contained a preparation notice rather than a deployable implementation/checkpoint. Do not substitute its name for the existing warp.

**Pixel3DMM:** dense normals/UV support a better geometric reconstruction prior, not a ready-made identity-preserving retoucher. The [author project](https://simongiebenhain.github.io/pixel3dmm/) reports over 15% relative geometric improvement on its reconstruction evaluation. [Code](https://github.com/SimonGiebenhain/pixel3dmm) is [CC BY-NC 4.0](https://github.com/SimonGiebenhain/pixel3dmm/blob/master/LICENSE); its [asset script](https://raw.githubusercontent.com/SimonGiebenhain/pixel3dmm/master/install_preprocessing_pipeline.sh) links weights but also requires MICA, PIPNet, facer and separately obtained FLAME assets. CUDA/PyTorch3D/nvdiffrast and Linux-oriented setup make Windows integration materially heavier. Not a commercial default.

**Recognition-license trap:** [InsightFace](https://github.com/deepinsight/insightface) separates MIT code from pretrained recognition models restricted to noncommercial research unless separately licensed. MirrorPPR evaluation's `buffalo_l` must not silently become a commercial runtime dependency. Identity metrics are useful evaluation aids, not a reason to identify people or upload embeddings.

## 4. Proposed adapter contract, not a claim of implemented inference

These are engineering recommendations, not assertions from the papers.

- `FaceAnalysisResult`: selected-face ID; source dimensions; pixel-coordinate ROI and invertible crop transform; semantic point/curve names; topology ID; pose; visibility/uncertainty; parser class probabilities; editable/protected masks; model/version provenance. Keep detection, parsing and alignment replaceable.
- `GeometryReshaper`: named semantic operations with explicit units and signed strength. Move control points, retain stable anchors and protected components, solve an inverse MLS or ARAP field, and sample the immutable original once for final export. Similarity/shape-aware constraints are a defensible fallback, not evidence of learned SOTA.
- `ExemplarRetouchBackend`: explicitly requires exemplar-before, exemplar-after and query. Do not pretend it implements exact linear slider semantics. Gated state should say why unavailable: missing weights, unresolved rights, unsupported runtime, or insufficient measured memory.
- Model manifest: exact source and revision, SHA-256, separate code/weight licenses, dependency notices, tensor format, crop/color normalization, class/topology map, expected shape, required providers, tested driver/runtime, peak RAM/VRAM, benchmark protocol and measured results. Do not invent hashes or memory requirements before testing.
- GPU worker process: cancellation between stages, stale-request rejection, bounded queue, one owner of GPU state, clean cancellation/OOM cleanup, no hidden model downloads. Show actual selected backend and fallback state. A scaffold must return `not_installed` or equivalent, never invented landmarks or a success-shaped blank mask.

## 5. Measurable acceptance gates

The following are proposed gates, not achieved results. Calibrate perceptual thresholds on a consented test set before claiming production quality.

1. **Pixel integrity:** strength zero bypasses resampling and is bit-identical; all pixels outside the declared feather-expanded editable region remain identical. Non-selected faces and protected accessories remain unchanged unless explicitly included by the operation.
2. **Geometry:** no nonpositive deformation Jacobian in the editable domain; no triangle flips or NaNs. Test positive/negative extremes, mirrored faces, overlapping controls and small/large ROIs. Target-landmark displacement error should initially be bounded to 1% of interocular distance for mild edits, then validated visually. Strength response must be monotonic where defined.
3. **Coordinate tests:** round-trip source-to-crop-to-source error below 0.5 source pixel; masks/landmarks align under rotation, EXIF orientation, letterboxing and full-resolution export. Topology conversion receives golden tests, not guessed index maps.
4. **Parsing:** reproduce the exact official split/crop/class averaging; report mean F1, IoU and boundary F1 plus eyes, lips, hair, glasses and other small classes separately. Compare SegFace variants and any cleared FaRL checkpoint on the same product images and annotation policy.
5. **Alignment:** report dataset-normalized NME, failure rate and pose/occlusion subsets. Evaluate contour stability under harmless crop/brightness changes. Refuse unsupported poses or uncertain landmarks rather than silently performing an aggressive warp.
6. **Retouch quality:** use at least 100 consented, diverse test portraits including pose, glasses, hair occlusion, fine texture and multiple faces. Blindly rate identity preservation, requested shape change, naturalness and collateral changes. Paired-target PSNR/SSIM/LPIPS and a properly licensed identity metric supplement, not replace, human review.
7. **Reproduction:** before calling MirrorPPR benchmark reproduction successful, pre-register tolerances such as 0.5 dB PSNR, 0.005 SSIM, 0.01 LPIPS and 0.01 face similarity versus the declared reference configuration, then investigate deviations. These are proposed engineering tolerances, not confidence intervals from the paper. Quantized/offloaded outputs require a separate regression run.
8. **Device qualification:** first record the actual GPU/VRAM, system RAM and Windows driver. Measure cold load, warm p50/p95, peak VRAM/RAM, cancellation, unload and repeated-edit stability. Separate 512-pixel analysis, preview deformation and full-resolution export. A provisional target is under 200 ms warm analysis and under 33 ms cached-geometry preview, but neither is currently verified. Generative 40-step retouch is a separate slow-quality mode, never promised as a real-time slider.
9. **Offline/package:** block networking during QA; verify missing weights fail clearly, installation never fetches models implicitly, filenames/hashes match the license manifest, and cancellation leaves no partial export. Run tests on the actual Windows RTX 4060 machine before declaring it supported.

## Release language

Appropriate now: “Source-reviewed candidate backends; SegFace integration planned; deterministic geometry fallback available; MirrorPPR research adapter blocked on licensing and device validation.”

Not supported now: “All algorithms are SOTA,” “MirrorPPR installed,” “guaranteed identity preservation,” “commercially cleared,” or “runs in real time on RTX 4060.”
