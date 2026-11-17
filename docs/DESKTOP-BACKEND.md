# UNRELEASED: bounded local desktop backend transport

This layer connects the existing model contracts to a one-shot Python process over framed standard input/output. It does not bundle weights, automatically download models or upload photos to an API. Approved research-test assets are staged separately; research execution and visual QA do not establish production quality or installed Windows availability. A missing runtime, missing/mismatched asset, unapproved execution configuration, failed adapter or unavailable selected device returns an actionable error, never a substitute result labelled AI. Existing pixel algorithms are not reclassified as model inference.

## Privileged host API

`require('./desktop-backend.cjs').createDesktopBackend(configuration)` accepts **app-owned main-process configuration only**, never a renderer message or user-supplied manifest. It returns:

- `probe(signal?)`: serializable runtime, devices and configured-model statuses. Each model includes ID/version, kind, adapter, tasks, exact weights hash, license review state, asset-verification state, status/reason and explicitly allowed devices.
- `createAdapter(modelId, modelVersion, deviceKind)`: asynchronously produces an adapter for the unchanged retouch/matting/inpaint/restore contracts. The device must explicitly be `cpu` or `cuda`; parsing is rejected here.
- `runParsing(context)`: separate analysis capability returning learned class probabilities. It does not retouch or mat an image.
- `runMatting(context)`: separate alpha analysis returning `{matte, provenance}` (plus a separately opted-in `foreground` plane) at exact original ROI dimensions. It supplies a full-coverage inference mask internally, with no renderer-provided strength or edit mask, and does not change image bytes.
- `cancelAll()`, `dispose()` and bounded `diagnostics()` counts. Disposed backends reject new work.

Configuration fields:

```js
{
  pythonPath: '/absolute/app-owned/runtime/python',
  backendRoot: '/absolute/app-owned/backend', // optional; defaults beside this module
  maxConcurrent: 1, maxQueued: 2, timeoutMs: 120000, killGraceMs: 250,
  maxPayloadBytes: 134217728, maxPixels: 16777216,
  manifests: [{
    id: 'explicit-model-id', version: 'explicit-pinned-version', kind: 'model',
    adapter: 'segface', // fixed allowlist: segface, birefnet, generative
    tasks: ['parse'], // parse must be separate; otherwise image-contract task list
    devices: ['cpu', 'cuda'],
    weightsAsset: 'checkpoint', weightsSha256: '<64 lowercase hex characters>',
    modelRoot: '/absolute/app-owned/model-root',
    assets: [{ name: 'checkpoint', relativePath: 'model.pt', sha256: '<exact SHA-256>' }],
    license: { id: 'reviewed-license-id', url: 'https://official-license-page', status: 'pending' },
    requiredPackages: ['torch', 'torchvision', 'numpy', 'Pillow'],
    enabled: false,
    config: { executionApproved: false /* other reviewed adapter settings */ }
  }]
}
```

Package names are distribution names used by `importlib.metadata`, for example `Pillow`, not the import name `PIL`. Only our fixture tests opt into `allowTestDoubles`; their results remain explicitly labelled `test-double`.

`backendRoot` does not select arbitrary scripts: the executable entry is always its fixed `worker.py`, with `protocol.py` and approved `adapters` beside it. The main app must choose the development root or fixed packaged resources root itself. Python cannot execute a file inside Electron ASAR. A distributable requires separately staged, approved runtime/worker/adapter/assets resources; this checkpoint does not assert that any current installer contains them. Do not package development virtual environments, caches or unreviewed model directories by accident.

## Wire format and adapters

There are no sockets, HTTP listeners, shell commands, pickle objects, JSON-encoded photo arrays or temporary photo files. Each process accepts exactly one request and exits:

1. Four-byte unsigned **big-endian** JSON-header length, maximum 65,536 bytes.
2. UTF-8 JSON header with `protocol: 1`, operation and exact `payloadBytes`.
3. Exactly that many binary bytes. Trailing and truncated frames fail.

Probe has no binary payload. Inference input concatenates original-ROI straight-alpha sRGB RGBA8 bytes and, for editing tasks, a finite `[0,1]` float32 **little-endian** edit mask. Parsing has no edit-mask payload. Width/height, in-bounds integer ROI, original size, source/mask sizes and resource limits are checked before execution. All incoming image/mask data is snapshotted before asynchronous work.

The worker imports only `adapters.segface`, `adapters.birefnet` or `adapters.generative`, after the trusted execution gate, asset hashes and device checks succeed. An installed directory is not proof that inference works. An absent Python module or missing `infer` implementation is unavailable, not a placeholder success. Adapter imports and inference stdout are redirected to stderr, leaving protocol stdout reserved. Diagnostic output is bounded and not retained by the host.

`infer(request)` receives:

- `jobId`, `task`, `model` descriptor, `originalSize`, original-pixel `roi`.
- `source: {width, height, data: bytes}` in exact ROI RGBA8.
- `mask: {width, height, data: array('f')}` or `None` for parsing.
- `selection` for parsing, plus validated `assets: {name: absolutePath}` and trusted adapter `config`.

It returns `{kind, width, height, data: bytes}`, with `kind: image` for RGBA8 color tasks, `matte` for float32LE foreground-alpha multipliers, or `parsing` for float32LE channel-major planes plus an explicit unique `classes` list. All output dimensions must equal the original ROI. Color-task alpha must be byte-exact. Matte/parsing values must be finite in `[0,1]`. The existing contract runner, not this transport, performs the bounded edit-mask blend against its immutable original.

## Parsing is separate, selection-aware analysis

`runParsing` accepts `modelId`, `modelVersion`, explicit `device`, `jobId`, `originalSize`, `roi`, `source`, optional `signal`, and:

```js
selection: { kind: 'detected-face' /* or user-face-roi */, faceId: 'stable-face-id', revision: 'source-selection-revision' }
```

Selection strings are bounded to 128 characters. Checking this metadata does not prove a face detector ran or that the ROI truly contains a face. The caller owns face selection and must reject stale UI revisions. The worker and host check and echo the exact selection identity/revision in provenance; a result for another face cannot be silently reused.

The return value declares `kind: parsing`, `layout: planar`, `encoding: unit-float32`, `space: roi-original-pixels`, exact `roi`, `width`, `height`, explicit class vocabulary, a `Float32Array`, and matching provenance. Parsing never masquerades as retouch or matting.

Output memory is explicit: 19 classes use `ROI pixels × 19 × 4` bytes. A 128 MiB payload permits at most 1,766,022 such pixels before framing, and the SegFace adapter deliberately uses the stricter 1,048,576-pixel ROI budget (79,691,776 output bytes). Larger ROIs fail, without silently downsampling original coordinates or dropping classes. There are multiple bounded copies in this prototype, so payload size is not the total memory footprint; physical model/runtime allocations also need separate profiling.

## Asset, license and device trust

Model roots, relative asset paths, command paths, adapter keys and config are privileged application configuration, not renderer inputs. Asset paths must stay within the real configured model root. Required regular files are SHA-256 checked in the host and again in the worker before adapter import; `weightsAsset` must match `weightsSha256`. If `config.sourceDir` is used, it must stay inside that root, every executable source file must appear in the pinned manifest, symlinks are rejected and vendor `__pycache__` directories are rejected. A hash identifies reviewed bytes but does not establish that those bytes are safe, licensed or high quality.

`license.status: approved`, `enabled: true` and `config.executionApproved: true` are fail-closed **trusted-configuration gates**, not user-consent records, legal acceptance or permission prompts. The host must obtain the required approval separately. No agreement is accepted by this code. Separately approved SegFace and BiRefNet research configurations have now executed on public NASA fixtures through this transport; the app catalog and release readiness remain separately controlled. Trusted optional `qualityStatus` is `not-evaluated`, `experimental` or `blocked`. A blocked model cannot execute even if `enabled` is accidentally true. Bounded `disabledReason` (up to 512 characters) is returned for user-visible explanation without accepting renderer configuration.

Probe imports only the separately installed official PyTorch runtime to check `torch.cuda.is_available()` and actual device-0 name/memory. It does not import research adapters or load weights. A CUDA-capable package alone never marks CUDA available. CPU/CUDA selection is explicit, rechecked inside the worker and reflected in provenance. No silent device fallback occurs. Adapter-specific model compatibility is not fully certified by a general device probe; actual inference may still fail closed.

The worker uses Python isolated mode, a fixed local script, no shell, a reduced environment without API credentials or inherited PYTHONPATH, and offline flags for common model libraries. These are safeguards, **not an OS network sandbox**: approved third-party code can in principle create sockets. Only separately reviewed and approved local code may execute. Asset files should be app-owned/read-only during inference; pathname reopens still have a time-of-check/time-of-use limitation if another process can replace trusted files.

## Typed desktop bridge and compact results

`desktop-ai.cjs` documents its request/result shapes with JSDoc and enforces them at runtime. Renderer calls can select only whitelisted request identity, model/version/device, original image dimensions, original-pixel ROI and exact RGBA8 source bytes. They cannot provide command paths, model paths, modules, approval flags, arbitrary config or API credentials. Requests are snapshotted before asynchronous work, and result provenance, shape, format and finite unit probabilities are checked again at the bridge boundary.

The bridge has three independent methods, all using the same request-ID cancellation map:

- `parse(request)`: existing debug/raw parsing return, including all explicitly labelled class planes.
- `parseMasks(request)`: returns `{kind: 'face-masks', width, height, roi, skin: Float32Array, protected: Float32Array, provenance}`. It requires the same explicit face selection as raw parsing.
- `matte(request)`: returns `{matte: {width, height, roi, space: 'roi-original-pixels', encoding: 'unit-float32', data: Float32Array}, provenance}`. It does not need or accept face-selection metadata, and requires explicit originalSize/ROI/source even when the frontend chooses the entire original image.

Compact masks are produced only after the SegFace helper validates the official 19-class order and normalized probabilities. The initial face-only policy begins with **skin + nose**, then applies `makeConservativeSkinMasks`: a bounded square minimum filter in original ROI pixels, followed by a confidence ramp from 0.65 to 0.95, clamped never to increase the guarded model probability. The default radius is `round(min(width,height)/160)` clamped to 2–12 original pixels. `protected = 1 - skin` therefore includes other classes **plus boundary margin and uncertainty**, not just the raw union of non-skin classes. The bridge exposes no renderer control over these safeguards.

This is deterministic application postprocessing, not a separate learned retouch model and not a claim that SegFace's single skin class includes the nose. Provenance records `classVocabulary`, the explicit `maskClasses`, and the helper's complete unchanged `maskPolicy` with radius, units, confidence rule and limitation. No fallback mask is invented when parsing fails. There is no separate beard/moustache class; this policy cannot correct confident model misclassification or guarantee facial-hair preservation.

Two original-ROI float masks use 8 bytes/pixel rather than sending 19 float planes (76 bytes/pixel) across renderer IPC, approximately 89.5% less probability payload. The worker/main process still materializes and validates the full class result, so the existing inference and main-process memory limits remain necessary. Compacting the IPC output is not a claim of reduced model memory.

Matting is alpha-only by default. Neither bridge nor transport composites a background, applies edit strength, rewrites input bytes or touches pixels outside the requested ROI. A predicted matte is not itself a modified photograph.

### Optional classical foreground color estimation

Only privileged BiRefNet matting configuration may opt into `foregroundRefinement: 'pymatting-1.1.16'`; absent or `false` keeps the default alpha-only behavior. This separately declared classical PyMatting `estimate_foreground_ml` operation is not learned retouch and does not fix incorrectly predicted alpha. The optional `foreground` is exact-ROI RGBA8, straight alpha, sRGB. Its alpha bytes must exactly match the input source; its RGB must also match where source alpha is below 255 or predicted matte equals 1. Missing opted-in planes, unsolicited planes, changed protected pixels, wrong formats or sizes fail closed at worker, host and bridge.

On the wire, the binary result contains float32LE matte bytes followed by foreground RGBA8 bytes, each `ROI pixels × 4`. The header explicitly declares `matteBytes` and foreground metadata/payload length. The combined result must fit the same payload budget. `provenance.foregroundRefinement` identifies `kind: classical-color-estimation`, implementation `pymatting`, version `1.1.16`, method `estimate_foreground_ml`, bounded settings, and `alphaDigest`: lowercase SHA-256 of the exact ROI float32LE alpha bytes used for estimation. The declaration also carries `sourceDigest`, SHA-256 of the exact original ROI straight-sRGB RGBA8 bytes. Worker, host, bridge and compositor verify both digests, preventing reuse with a different source that happens to share the same alpha. A foreground estimated from raw model alpha must not be reused after manual keep/remove changes alpha; recompute color estimation against the corrected alpha without rerunning the model, or remain alpha-only. No automatic post-edit recomputation is currently wired.

The immutable-original contract compositor additionally requires `applyForeground: true` plus explicit `foregroundStrength` in `[0,1]` to apply color. The color strength defaults to zero and is independent of overall `strength` and the supplied edit mask. It first interpolates original-to-estimated RGB in linear light, then blends original and estimated foreground as premultiplied linear-light layers with `w = editMask × strength`. Result alpha remains `round(originalAlpha × (1 − w + w × matte))`. Converting back to straight sRGB never changes outside-ROI/zero-mask pixels or hidden RGB at zero output alpha. `foregroundStrength: 0` is byte-exact alpha-only matting, not necessarily an unchanged image if matte alpha was requested. Overall strength zero or an empty mask is a full-image exact no-op with no inference. Provenance reports whether color was applied and its independent strength. Default callers remain byte-compatible with prior alpha-only behavior. Renderer foreground controls are not wired by this module.

The pure JavaScript SegFace helper and its metadata manifest must be included alongside the application bridge even if Python/model resources are excluded from ASAR. Catalog readiness remains separately controlled after review; renderer requests cannot enable it.

All model results and probe entries also preserve a trusted `executionProfile`, independently derived from app configuration in both host and worker. SegFace records variant, 512 input size, float32 and thread cap. BiRefNet records input size, precision and thread cap; 512/1024 profiles are explicitly labelled `diagnostic-512`/`diagnostic-1024`, never `hr-2048`. Its CPU BF16 configuration is accurately labelled `mixed-bfloat16`, with `operatorPrecision: {deformConv2d: 'float32', weights: 'float32'}`, not pure BF16. An unexpected profile rejects provenance, even when weights/version/device match. BF16 and FP32 runs cannot silently present identical profile metadata. The renderer cannot set these fields.

## Lifecycle and cancellation

Default limits are one active process, two queued operations, a 120-second per-process deadline and a 250-millisecond termination grace period. The queue is bounded, and a cancelled process retains its concurrency slot until its actual `close` event. Cancellation rejects queued work without launching it, rejects running results promptly, requests `SIGTERM`, then requests `SIGKILL` if still alive. Timeout and disposal use the same termination path. Late bytes and failures cannot resurrect cancelled results. Cancellation also reaches asset-verification/preflight work.

This is stronger than cooperative-only cancellation in the pure contract scaffold, but it is not a guarantee of immediate native/GPU cleanup or descendant-process termination. The supported adapters must not spawn unmanaged subprocesses. Tests prove direct-process lifecycle on this Linux execution environment, not Windows production behavior. A new contract job supersedes and physically cancels its old worker; standalone parsing callers must explicitly cancel obsolete jobs and compare selection revisions before displaying results.

## Verification and current limits

Run `node --test tests/backend-contracts.test.cjs tests/desktop-ai.test.cjs tests/desktop-backend.test.cjs` and the aggregate `npm test`. The focused contract/bridge/transport suite passes 83 tests in this checkpoint. Tests use a locally authored fixture script in temporary directories with `kind: test-double`, never research code or claimed inference. They cover missing runtime, manifest/path/hash gates, explicit device rejection, original-ROI/selection/provenance checks, result validation, queue/cancel/timeout/forced termination, process crashes and oversized/trailing output. The actual authored worker is separately tested to reject disabled execution before importing any adapter.

Approved CPU end-to-end checks now include:

- SegFace on the public Suni fixture: `desktop-ai.parseMasks → worker → pinned model`, 13.80 seconds cold wall, ROI 471×612. Input bytes were unchanged, and compact masks exactly matched independently saved model probabilities. Report: `quality/segface/bridge-e2e.json`.
- BiRefNet HR 2048 mixed-BF16 on the public Pettit fixture: `desktop-ai.matte → worker → pinned model`, 116.24 seconds cold wall, full original 1920×1280, continuous alpha output and unchanged input. Outputs: `quality/matting/pettit-2048-bf16/`. Worker peak memory was not captured for that run; the reported Node RSS is not total model memory.

These are real CPU research executions, not Windows/CUDA/RTX 4060 benchmarks or proof of production-quality matting. The Suni HR review found wrong suit alpha and foreground haze; foreground color estimation can reduce edge contamination but cannot repair the wrong alpha. Mixed-BF16 diagnostic comparisons are not evidence of exact FP32 equivalence or a successfully tested HR FP32 profile.

- BiRefNet HR 2048 mixed-BF16 plus explicitly enabled PyMatting on the public Eileen fixture: 114.24 seconds cold wall, exact 725×900 source. Separate continuous alpha and straight-sRGB foreground were returned with byte-exact source alpha, source and alpha digests, and unchanged input. Linux `getrusage(RUSAGE_CHILDREN)` high-water RSS was 7,353,060 KiB (about 7.01 GiB), not a sum of concurrent process memory. Outputs and measurements: `quality/matting/eileen-2048-bf16-foreground/`. Its saved real output was subsequently revalidated through the immutable JS compositor at foreground strengths 0/0.5/1 without another model run; strength zero changed no RGB channels. See `compositor-strengths.json` and the three RGBA outputs. This proves the explicit candidate path, not visual acceptance. Current UI deliberately rejects optional foreground until a corrected-alpha-aware color-only workflow exists.

Remaining release gates include adequate visual/identity/edge evaluation, high-resolution memory/latency coverage, Windows process/resource validation, reviewed runtime packaging and signed distribution. The reviewed disabled BiRefNet catalog reference is `quality/matting/catalog-reference-disabled.json`, with refinement off by default. No API backend or photo upload is implemented by this module.
