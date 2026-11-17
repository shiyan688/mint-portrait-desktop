# Local image pipeline

`src/pipeline.js` is an ES module for the Electron renderer. Its only inference import is the bundled `assets/vision/vision_bundle.mjs`; all model and WASM URLs are local. It does not upload images or make external HTTP requests.

## Public contract

- `DEFAULT_SETTINGS`: frozen flat settings object. Callers should `structuredClone` before editing.
- `PRESETS`: frozen array of `{ id, name, description, settings }`.
- `initModels(onProgress?)`: initializes local MediaPipe FaceLandmarker and ImageSegmenter with `delegate: 'CPU'`, image mode, and up to five faces. The callback receives a readable Chinese progress string. Concurrent calls share initialization; a failed initialization can be retried. Resolves `{ ready: true, delegate: 'CPU', maxFaces: 5 }`.
- `decodeImage(blob, maxEdge = 4096)`: decodes a Blob/File using browser orientation handling. Returns `{ canvas, width, height, originalWidth, originalHeight, scaled }`. The working image is never larger than a 4096-pixel long edge or 16,777,216 pixels. The original file is never modified.
- `analyze(canvas)`: performs real model inference on a maximum 1280-pixel-long-edge copy and returns `{ landmarks, mask, faceCount }`. `landmarks` is an array of face meshes; a successful detection ordinarily has 478 `{ x, y, z }` points. No face means `landmarks: []` and `faceCount: 0`, never a fabricated center face. `mask` is `{ width, height, data: Float32Array, maxValue: 1 }` with copied person probabilities. A person can be segmented without a visible face. The caller owns caching per source image.
- `render(canvas, settings, analysis, options?)`: returns a new HTMLCanvasElement without changing the source or cached analysis. Optional `options.signal` is an AbortSignal. Actual pixel work is off the UI thread, with at most two workers active.
- `cancelRenders()`: immediately terminates active pixel workers and rejects active and queued renders with `AbortError`. Initialization and cached model analysis remain available for the next render.
- `encode(canvas, format = 'jpeg', quality = 0.94)`: returns a Uint8Array. Accepts JPEG/JPG, PNG and WebP (or their MIME strings); rejects unsupported formats. PNG preserves alpha. JPEG composites transparency onto white before encoding. Quality is clamped to 0–1.

## Settings

All numeric settings are percentages, except background radii. Ranges:

- exposure, contrast, saturation, temperature: -100 to 100. Exposure maps this range to -2 to +2 stops and is applied in linear light.
- smooth, brighten, slim, eyes: 0 to 100.
- warmth, nose, jaw: -100 to 100. Positive nose/jaw narrows; negative widens.
- bgMode: `original`, `blur`, `color`, or `transparent`.
- bgBlur: 0 to 50; bgFeather: 0 to 20. These are pixel radii at a 1000-pixel long edge.
- bgColor: `#RGB` or `#RRGGBB`.
- spots: array of normalized `{ x, y, r }` entries. `r` is relative to the shorter image edge. At most 64 spots are applied, with radius capped at 0.12.

Beauty and reshape run only on valid detected meshes. Missing segmentation means background edits are a no-op, not an ellipse or guessed person mask. Manual blemish spots do not require face detection because the user selected the exact regions.

Order is blemish healing, landmark-based skin edits, global tone, mask-based background composition, then landmark-based reshape. Applying geometry after background composition avoids using an unwarped matte on a warped subject boundary. Small local background displacement is an expected consequence of this lightweight geometric approach.

## Hosting

Serve `.js`, `.mjs`, and `.cjs` as JavaScript; `.wasm` as `application/wasm`. `pixel-worker.js` loads `portrait-engine.cjs` using `importScripts`. The UI does not need to load the engine itself. Use a secure, standard local scheme (as the desktop app does) or localhost. The Content Security Policy must allow same-origin workers and local WASM compilation (`wasm-unsafe-eval`).

CPU refers to the neural inference delegate. The MediaPipe graph still uses browser WebGL for image transport. A device with unavailable WebGL or a broken graphics driver can fail initialization even when CPU inference is selected. The pipeline reports that failure and does not substitute simulated AI results. Browser-side model calls are synchronous but serialized, downscaled and separated by UI yields. Pixel-heavy editing is separately cancellable in workers; an individual model invocation cannot be interrupted midway.

The working pipeline uses browser 8-bit sRGB canvas output. It is not a RAW processor, 16-bit editor, ICC-managed proofing system, professional hair matting system, or a reproduction of any proprietary retouching algorithm. There is no guarantee that every face, hair edge, pose, or lighting condition will be segmented correctly.

## Verification

- `node --test tests/pipeline.test.cjs`: 13 passing unit tests covering identity, missing-face/mask safeguards, tone invariants, alpha/color composition, manual healing, invalid buffers, worker concurrency, cancellation, and recovery. Lifecycle tests use explicitly labeled DOM/Worker doubles and do not claim to exercise browser inference.
- `node tests/pipeline-browser.cjs`: a real Chromium integration suite, with all requests restricted to the local test server. It exercises the bundled astronaut image, real 478-point detection, real nonconstant person confidence, image edits, PNG/JPEG encoding, a blank no-face image, resize, cancellation and post-cancel recovery. It requires Playwright and Chromium. Set `PLAYWRIGHT_PATH` and `CHROMIUM_PATH` if they are not at the development defaults.
- Development execution status on 2026-10-21: syntax and the 13 unit tests passed. The Chromium suite was attempted but BLOCKED before browser startup: this execution sandbox rejected Chromium's process-singleton socket with `Operation not permitted`. The permitted escalation route failed during sandbox setup on a read-only runtime mount. Therefore real browser CPU/WASM inference, browser export, and Windows execution are not verified by this run. The integration script is provided for a capable development machine. Do not report the blocked checks as passed.

API behavior was checked against the bundled `@mediapipe/tasks-vision` 1.1.1 type definitions and implementation. Official API references: [FaceLandmarker](https://developers.google.com/edge/api/mediapipe/js/tasks-vision.facelandmarker), [ImageSegmenter](https://developers.google.com/edge/api/mediapipe/js/tasks-vision.imagesegmenter).
