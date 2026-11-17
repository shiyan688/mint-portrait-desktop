# Generative adapters: implemented transport, pending live validation

This module is **not an enabled AI feature and not a SOTA claim**. It implements real official API request/response paths, consent-bound lifecycle, strict local compositing and mocked tests. No API key was configured, no photo was uploaded, no paid request was made, no model was installed, and no live result was validated while implementing it. The existing deterministic portrait engine and local model contract are unchanged.

## Ownership and modules

- `backend/adapters/generative/index.cjs`: main-process session, preparation, trusted consent callback, serialized jobs, candidate accept/reject and invalidation.
- `backend/adapters/generative/providers.cjs`: optional OpenAI and Alibaba official transports, disabled by default.
- `backend/adapters/generative/common.cjs`: bounded byte/pixel validation and sanitized errors.
- `backend/adapters/generative/index.d.cts`: typed interface.
- `backend/adapters/generative/seedvr2-evaluation.json`: non-executable local-upscale evaluation checklist. It grants no execution permission.
- `tests/generative-adapters.test.cjs`: **all codecs, images and network responses are test doubles**. Its fake PNG codec is not a usable encoder and must never enter the application.

## Integrator boundary

Import only in trusted Electron main-process code. Never expose provider instances, `fetchImpl`, `getApiKey`, `confirmUpload`, endpoints or arbitrary functions through IPC. Do not add remote request permissions to the renderer. `getApiKey()` is an injected local credential resolver, not a credential installer/store; this change neither reads environment secrets automatically nor creates persistent credentials.

The desktop integrator owns the production codec, including a verified BGRA/RGBA, straight/premultiplied alpha, orientation and sRGB conversion. Raw Electron native-image bitmap bytes are not assumed to be straight RGBA. Encode normalized pixels to a fresh metadata-free PNG rather than forwarding the original file/EXIF.

Create a session with `image`, a unique `photoRevision`, `codec`, explicitly configured providers, and a trusted `confirmUpload(summary, signal)` callback. Providers are disabled unless trusted main-process configuration explicitly sets `enabled: true`; there is no automatic default provider, model substitution or offline fallback.

The request has:

- `task: 'instruction-edit' | 'inpaint'`, exact provider/model, prompt, strength in [0,1].
- A full-original-size `Float32Array` mask with `space: 'original-pixels'` and `encoding: 'unit-float32'`. This is a separate whole-canvas contract, not an ROI in preview coordinates.
- An explicit output size, when original size does not meet the provider's constraints.
- `geometryPolicy: 'require-source-size'` (default), or an explicitly disclosed `resize-to-source` opt-in.
- Explicit quality. Alibaba prompts have a conservative application limit of 1200 UTF-8 bytes to reduce the risk of its documented token-limit truncation. Alibaba does not expose this selector; `high` means provider-defined quality, not an invented HTTP parameter.

`prepare(request)` snapshots image/mask/instruction/settings, encodes PNG, and returns a five-minute summary containing a one-use ID, request digest, photo revision, recipient endpoint, model, upload bytes, image/mask hashes, dimensions, quality and cost/privacy disclosures. Preparation performs no HTTP request or credential lookup.

`start(preparedId)` returns `{id, state, result, cancel}`. Its internal trusted callback must display that exact summary to the user and return `{approved: true, preparedId, requestDigest}` only after approval. Renderer-controlled `confirmedUpload`/`confirmedCost` booleans cannot authorize the module. Connect cancellation to dismissing the native dialog. Subscribe to `job.result` immediately to handle cancellation rejection.

A confirmation permits **one generation**. There is no retry, including after network uncertainty. Metered pricing is disclosed with an official pricing link; no numeric quote is fabricated. `estimate: null` and `hardCapEnforced: false` are intentional: these API endpoints do not implement a client-specified monetary ceiling. The UI must explain this and require appropriate current pricing/account spending review, rather than present an unenforceable cost guarantee. Do not activate live usage until that flow is reviewed.

A successful result is only a candidate. `accept(candidateId)` returns an isolated image/provenance for an explicit history commit. `reject(candidateId)` discards it. Neither changes the session's original. Do not export, overwrite or apply automatically.

Call `invalidate()` on photo/source revision change, edits, undo/redo, closing, and navigation. It irreversibly closes that session, cancels jobs and invalidates candidates/approvals. Create a new session for the new revision. A new valid job supersedes unfinished work and any previous candidate. Late output cannot publish even if transport ignores abort. Physical requests are serialized; ignoring abort can delay the next job until the underlying promise settles, but cannot create concurrent generation requests. A default three-minute timeout rejects the job. Cancellation/timeout cannot guarantee the provider stopped or refunded processing.

## Pixel and geometry guarantees

The private original is never passed by reference to adapters. At publication, RGB is blended once using edit-mask × strength. Original alpha is copied exactly. Pixels at zero edit weight, including hidden RGB, remain byte-for-byte unchanged. OpenAI receives a transparent edit-region mask, but its model is not assumed to obey that mask exactly; the application compositor provides the strict outside-mask guarantee.

Unexpected output geometry is rejected by default. Explicit resize mode requires the integrator's validated resampler and records `explicit-resize-to-source` plus original generated dimensions in provenance. Resizing is not a fidelity claim and can cause spatial mismatch at boundaries. Images are capped at 16,777,216 pixels, encoded inputs at 8 MiB each, and output PNG at 32 MiB. JSON and binary responses have streaming byte limits; PNG dimensions are checked before decode. Native decoder safety and accurate pixel interpretation still require integration tests.

Remote provenance uses `kind: 'api'`, provider, exact requested model, returned request ID when available, request digest, photo revision and transform. It deliberately does **not** invent a weights hash, local GPU identity or provider snapshot guarantee. The existing local-model contract remains separate.

## Verified official transport specifications, 2026-10-21

OpenAI uses `POST https://api.openai.com/v1/images/edits`, multipart `image[]`, optional PNG `mask`, prompt/model, `n=1`, explicit size/quality and PNG output. Supported models are `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare`. PNG is returned as base64. Custom sizes are multiples of 16, aspect ratio at most 3:1, maximum edge 3840, total pixels 655,360–8,294,400. Model mask guidance is not strict pixel protection.

- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/docs/pricing

Alibaba's documentation updated 2026-10-11 uses a workspace-specific HTTPS endpoint: `{WorkspaceId}.{ap-southeast-1|cn-beijing}.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`. Regional keys are not interchangeable. This adapter selects dated Qwen Image 2.0 versions, sends base64 input, one text instruction and `n=1`, with prompt rewriting off. Output size is 262,144–4,194,304 pixels. There is **no invented mask argument**: native inpainting is rejected. A soft local mask may limit compositing for instruction editing, but does not guide the model spatially. Signed output is fetched only from the narrowly permitted `dashscope-result*.oss-*.aliyuncs.com` host pattern, without API credentials and without redirects. New legitimate output domains require an explicit code review, not a wildcard fallback.

- https://www.alibabacloud.com/help/en/model-studio/qwen-image-edit-api
- https://www.alibabacloud.com/help/en/model-studio/model-pricing

## Local upscale remains a separate next step

`SeedVR2` is an available evaluation candidate, not an installed backend. Its official project/weights declare Apache 2.0; the linked numz integration documents GGUF, BlockSwap and VAE tiling for 8GB-class hardware. Exact GPU VRAM, RAM, code commit, model-file size/hash and quantized-artifact origin remain unverified. No automatic download, shell execution, `trust_remote_code` or package install is implemented.

Before any custom-repository execution, obtain source-specific authorization and verify its exact code, dependencies and model assets. Do not run a giant CPU generation merely to claim progress. A suitable GPU evaluation must measure memory, latency, cancellation, seams, color drift, identity drift and invented detail against public or separately authorized images.

Upscale must return a **new canvas** with explicit input/output dimensions, scale, pixel-coordinate transform and independent candidate/history/export handling. It cannot be silently routed through `restore` or this same-size edit contract. No upscale UI should be enabled until that contract, model runner and hardware validation exist.

## Checks and pending work

Run `node --test tests/generative-adapters.test.cjs`, then aggregate `npm test`. Focused tests cover official payload construction, default-off/consent boundaries, input snapshots, pixel invariants, response validation, URL restrictions, no retries, cancellation, stale work and explicit geometry handling. They do not prove current API account access, provider billing, Windows codec behavior or model quality.

Pending before release: trusted main-process IPC/dialog integration, production PNG codec validation, correct non-offline privacy wording if APIs are enabled, credential setup owned by the user, explicit live-call authorization, live API error/latency tests with authorized fixtures, and visual/identity quality acceptance. No installer/release readiness is asserted by this module.
