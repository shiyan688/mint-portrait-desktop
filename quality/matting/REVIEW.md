# BiRefNet HR-matting approved public evaluation

This is an evaluation candidate, not an Android-native or SOTA certification.

## Exact reviewed source and license

- Author model: https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting/tree/5d6b6f8adcb5b417c871b1d84ceaae9871355b7f
- Author repository: https://github.com/ZhengPeng7/BiRefNet
- MIT license pinned at https://github.com/ZhengPeng7/BiRefNet/blob/97e4f35d74043427b0e9ba935ca10991853a36bc/LICENSE
- 444,473,596-byte safetensors: SHA-256 a5a4de698739ea5e0e8bbab28e1b293dde95092b87a442d566cbc585c53cef55, matches official Hugging Face LFS digest.
- Exact Python/config/weights/license hashes are in the approved local manifest, and checked by the host and Python worker before import.

Static review found no network, subprocess, shell, socket or file-write calls in the reviewed model source. An unused torch.load branch exists for backbone pretrained weights; constructor is forced to bb_pretrained=False. Several eval calls select fixed local architecture names from author code, not image metadata or user requests. We use explicit local imports and safetensors, not trust_remote_code or online from_pretrained. This review reduces risk but is not a claim that third-party code is formally secure. Environment offline flags are not an outbound security sandbox.

## Semantics

Input is straight-alpha sRGB RGBA8. The model receives RGB stretched to an explicitly recorded network resolution and ImageNet normalization. Output logits undergo sigmoid and bilinear resizing to the exact original ROI. No threshold, min-max rescaling, fake fallback, border blur or color whitening is added. The output is a continuous alpha multiplier; original alpha and edit strength are composed by the host once. RGB is untouched. Foreground-color decontamination is NOT implemented, so source-background color may remain in translucent hair edges.

512 and 1024 are diagnostic profiles, not HR default. The quality candidate uses 2048 input. CPU float32 is explicit, with 4 threads; no claimed RTX 4060 or Android timing. Model loading occurs per process, and reported wall time includes import, asset hashing, loading, prediction and protocol transfer. Adapter stderr records inference-only timing.

## Public test provenance

Existing NASA sources and hashes: ../fixtures/manifest.json. Don Pettit glasses / cluttered ISS scene: ../fixtures/pettit-provenance.json. NASA usage policy: https://www.nasa.gov/nasa-brand-center/images-and-media/ . These are factual tests, not product/marketing images or endorsement. No private image was transmitted.

NASA photographs have no ground-truth alpha. We report alpha continuity/output hashes and visual findings, NOT fabricated SAD/MSE benchmark scores. PPM official repository https://github.com/ZHKKKe/PPM supplies an annotation dataset under CC BY-NC-SA 4.0; even if obtained, BiRefNet training overlap makes it unsuitable as proof of unseen-test SOTA.

## Reproducible checks

- backend/.venv/bin/python -m unittest discover -s backend/adapters -p 'test_birefnet*.py' -v
- backend/.venv/bin/python quality/matting/run_birefnet.py --probe
- backend/.venv/bin/python quality/matting/run_birefnet.py --fixture suni --side 2048

The harness calls the actual one-shot bounded Python worker protocol, not a model mock. Raw float32 alpha, 16-bit and 8-bit preview, comparison, manifest, response, summary and stderr are stored per run. Runtime test completion and image observations are recorded separately; do not infer success merely from this scaffold.

## Observed runtime and failure boundaries

- 512 CPU float32: actual worker protocol succeeded, 22.67 s cold wall, 1,985,872 KiB child peak RSS. This is diagnostic resolution, not HR quality.
- 2048 CPU float32: SIGKILL (-9) after 118.43 s, no output. Memory exhaustion is plausible but not established because OOM/cgroup logs are unavailable. No result/fallback was fabricated.
- Explicit CPU mixed-bfloat16 profile: model parameters and deformable convolution remain float32; supported conv/attention operations use bfloat16 autocast. This is NOT pure bfloat16. The exact vendor source and safetensors are unchanged.
- At 512, mixed-vs-float32 alpha MAD = 0.00006409, soft-region MAD = 0.0009641, maximum difference = 0.01610. These are precision-comparison metrics, not ground-truth accuracy or HR equivalence.
- Suni 2048 mixed-bfloat16: 109.56 s cold wall, 95.88 s model forward, 7,345,772 KiB child peak RSS; actual 795x900 soft alpha returned.
- Pettit 2048 mixed-bfloat16: actual desktop Node ai.matte -> Python worker -> author model succeeded at 1920x1280, 116.24 s cold wall, source bytes unchanged. Parent/Node RSS sampling did not observe the worker, so this run has no reliable total-RSS figure.

## Explicit optional color refinement

Official PyPI PyMatting 1.1.16 is MIT: https://pypi.org/project/PyMatting/1.1.16/ . Documentation: https://pymatting.github.io/foreground.html#estimate_foreground_ml and https://pymatting.github.io/examples.html . The pinned wheel SHA-256 published by PyPI is `6ad3f787f90d7720b60e9734c33588cb30f98a66abf7bd772fa499d3a32b466a`.

`config.foregroundRefinement='pymatting-1.1.16'` explicitly opts into a separate straight RGBA foreground plane. Absent/false remains alpha-only. The estimator works in linear-sRGB using default multilevel parameters; its color influence fades smoothly to zero at fully opaque predicted alpha, and originally non-opaque source pixels keep their RGB. Original alpha bytes and the learned alpha are immutable. This is classical color estimation, not a new learned retouch algorithm or SOTA claim.

Actual Suni A/B uses the exact saved HR alpha, unchanged. White haze at the right hair edge is visibly reduced by color estimation. Wrongly translucent/missing parts of the white spacesuit remain: this is a genuine alpha/subject-selection defect and must be corrected, not concealed by a successful transport check. Person+clothing is the target, so correct suit retention is not an error.

NASA public scenes have no reference alpha. The PPM download route displayed a Drive virus-scan warning and was not continued; no new warning acceptance or dataset agreement was silently made. No unseen-test benchmark score is claimed.

## Additional executed checks

- 1024 precision pair succeeded: float32 50.69 s / 3,867,032 KiB; mixed-bfloat16 35.13 s / 2,889,380 KiB. MAD 0.0008429, soft-region MAD 0.0044569, p99 absolute difference 0.01873, max 0.05365. Worst pixel is head-adjacent spacesuit transition (446,86); both profiles are semantically wrong there. This does not establish HR float32 equivalence.
- Eileen actual Node -> worker 2048 mixed-bfloat16 + optional PyMatting succeeded in 114.24 s, waited-process high-water RSS 7,353,060 KiB. Continuous alpha and separate foreground are preserved; original buffer unchanged, foreground source-alpha byte exact, alphaDigest/sourceDigest verified against their canonical buffers.
- `render_strengths.py` generated true0/0.5/1 linear-light original-versus-estimated foreground blends for Suni and Eileen. Same alpha for every panel, original alpha unchanged, fully opaque pixels protected; 0 is byte-identical source RGB. Corrected matte/source changes invalidate the old foreground estimate rather than silently reusing it.
- Optional foreground helper on known synthetic linear-light mixtures with exact alpha reduced foreground-color MAD from0.45186 to0.001252 on white and0.17878 to0.000908 on blue. These controlled synthetic color-solver checks are not human matting benchmark accuracy.
- 30 local matting/foreground unit tests pass, with estimator doubles clearly separated from real public/controlled executions.

## Visual observations and release gate

- Suni: genuine failure retained. Suit should remain foreground but some head-adjacent fabric becomes transparent. White/gray edge color contamination is substantially reduced by optional foreground estimation; incorrect alpha remains. Strength0.5 is an available compromise, not a universally optimal preset. No automatic fix or SOTA-quality pass claimed.
- Pettit: the complete person/clothing and handheld camera are retained on a cluttered scene; frontal glasses survive. A cable attached at the wrist is also included. Whether to retain/remove it is a user-edit decision. This example does not test transparent lenses extending across a different background.
- Eileen: short hair is extracted with continuous soft edge details. On green/white, optional color estimation visibly reduces the original gray fringe; strength1 can darken edge fuzz compared with0.5. No reference alpha means strand-recall/per-pixel quality is not measurable here.
- All these are cloud Linux CPU checks. Windows/Electron interaction, RTX4060 CUDA, Android-native inference, mobile runtime/memory, robust batch, full app feature parity and SOTA across tasks remain unvalidated/unimplemented as separately documented.
- The alpha-only pipeline and optional foreground transport are candidates. Re-estimating colors after manual mask correction needs a color-only endpoint using the edited alpha; rerunning matting must not erase manual changes. Refinement UI remains gated until that workflow is correct.

## Final bounded control and checkpoint

- Victor HR 2048 mixed-bfloat16, alpha-only: actual Python worker succeeded in 111.23 s cold wall, child high-water RSS 7,353,464 KiB. Source 646 x 900 retained; 10,011 continuous-alpha soft pixels. Alpha SHA-256 `6738db74f281cb289c32d3779e137ebca95887777e8f925ec2a0baad21e73607`. Person and blue clothing silhouette are retained; the bald head edge is relatively clean on white/green/purple. Purple/blue light on the jaw is present in the source photograph and not automatically a matting defect. This simpler contour does not test dense hair, nor establish ground-truth accuracy.
- Actual shared-JS saved-output compositor replay at strengths 0/.5/1 was inspected on black/white/green backgrounds. Alpha matches rounded original-alpha times learned-alpha exactly using JavaScript-equivalent Float64 arithmetic. Visible RGB matches Python exactly at 0/1 and differs at most 1 LSB at .5 due to rounding. No new inference was used for this replay; original model provenance is retained separately from explicit saved-output test-double provenance.
- Four public HR scenes are now complete. Inference is stopped for this bounded checkpoint. Model registration remains experimental/quality-gated due to documented suit-alpha failures and unvalidated edge cases.
