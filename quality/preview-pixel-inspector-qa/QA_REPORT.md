# Preview RGB(A) inspector: independent offline QA

Final freeze verified: 2026-10-22 UTC. No production files or existing tests were modified by this independent audit.

## Result

- 66/66 independent tests passed; 0 failed and 0 skipped.
- 289/289 combined inspector and reference-comparison regression tests passed; 0 failed and 0 skipped.
- No defect was found in the exercised scope. This is not a claim of browser, Electron, Windows installation, or visual-layout acceptance.
- Final production hashes match the implementation owner's freeze; see `qa-manifest.json`.

## Reproduce

Run from the source root with installed dependencies only:

    MINT_PIXEL_QA_EVIDENCE=1 node --test tests/preview-pixel-inspector-independent.test.cjs
    node --test tests/preview-pixel-inspector*.test.cjs tests/reference-compare*.test.cjs

No npm, network, browser launch, server/socket, model download, or external photo access was used. Node v24.19.0; installed native raster package @napi-rs/canvas 0.1.100; installed Sharp 0.35.5.

## Independent coverage

- A separately authored mapping oracle checks 5,000 deterministic fractional-zoom/pan cases, image and viewport half-open boundaries, clipped/partly hidden images, empty intersections, small rectangles, and strict input rejection without getter/coercion execution.
- Strict dimensions and storage checks cover the exact 1280 × 1280 / 6,553,600-byte ceiling; invalid, oversized, offset, shared, resizable, detached, and subclass storage; oversized backing buffers retained through tiny subviews; intrinsic accessors that bypass shadowed getters.
- A separate RGBA oracle checks opaque, all 254 partial-alpha levels, and fully transparent samples. Alpha-zero RGB and endpoint lists are hidden; partial-alpha RGB remains the actual uncomposited readback. A pixel may correctly have both zero and full RGB channels.
- Actual shipped app event handlers run in the existing authored DOM/canvas/IPC environment, not a reimplementation of the feature. A deliberately conflicting display-canvas buffer confirms that only the fresh accepted-render canvas is sampled.
- Crop plus clockwise rotation plus horizontal flip is checked against independent source-coordinate algebra at three zoom levels. Actual pan, wheel, fit, source-switch/aspect-ratio, and half-open viewport clipping paths are exercised. A wheel event uses its own current coordinates, not the last hover location.
- Cache reuse across 300 moves and repeated wheel/pan/fit operations incurs one readback and no render. Overbudget accepted frames reject before requesting a context. Disable, source/mode invalidation, pointer cancellation/loss, leave, blur and pagehide clear the appropriate values/state.
- Twenty-two blocked states clear displayed values/cache while preserving the enabled preference, including reference/wipe, held original, manual/point/matte tools, crop/drafts, local/matte/diagnostic/face inspection, export/project/preset/dialog locks, backend/analysis, pending and failed renders.
- Provenance tests reject changed photo, Blob, working source, source revision, render generation, view token, canvas identity/dimensions and same-display-stamp/nested recipe changes.
- Actual edit debounce, failure/retry, stale asynchronous render completion, readback failure with no retry loop, off/on recovery, and reentrant invalidation are covered. Actual undo, redo, preset apply and project replacement produce fresh readouts. Busy project cancellation/failure resumes its own queued preview without a manual render call.
- Serialized project bytes, source bytes, complete histories, review, preset documents, native-dirty notifications, export scope and render/model/decode counts remain unchanged by readout-only operations.

## Native pixel evidence

`synthetic-native-alpha-rgba.png` is a synthetic native-raster fixture, NOT an app screenshot. Each row has one of all 256 alpha codes; all 65,536 pixels are checked. Sharp encodes the actual native getImageData bytes, then independently decodes the PNG and verifies an exact RGBA hash match. Its visual content was inspected after generation.

`synthetic-native-alpha-evidence.json` records authored and actual sampled values at selected coordinates and the hashes. Native premultiplied storage can quantize authored partial-alpha RGB. The authoritative tested values are the actual uncomposited canvas readback, not the authored pre-storage bytes or a checkerboard composite.

Native RGBA SHA-256: f7fa4d238d6483c05946e2b7fb67dcdf68b6782318c55f4efc5418d15396ec68

PNG SHA-256: 2c62cd3f670afe9bea860416a21db72f0c1a5bb209078a36dcdf3be5f9ab1fd4

An additional actual-app-handler test uses a native Skia canvas. Only the getImageData signature is adapted: production requests the browser ImageDataSettings object `{ colorSpace: 'srgb', pixelFormat: 'rgba-unorm8' }`; installed Skia requires the color-space string `'srgb'`. The test asserts the production options before translating that signature. Pixels, production mapping, lifecycle and readout code are not replaced. This adaptation does not demonstrate Chromium API or color-management compatibility.

## Limits

- DOM, viewport geometry, timers and IPC are authored doubles. Actual CSS layout, high-DPI display coordinates, pointer capture behavior, screen-reader behavior, browser color management, dialogs, and hardware performance remain unverified.
- No real browser or Electron screenshot was taken. Existing browser/socket/npm restrictions were not retried or bypassed.
- No user/private/public portrait, AI inference, model, network request, new dependency, installer build or native Windows execution was used.
- This worker ran focused inspector/reference regression, not the entire repository test suite. A parent-run aggregate result must be reported separately.

## Artifacts

- `tests/preview-pixel-inspector-independent.test.cjs`: the 66 independent checks.
- `quality/preview-pixel-inspector-qa/independent-freeze.log`: final independent TAP-style output.
- `quality/preview-pixel-inspector-qa/inspector-reference-regression.log`: final 289-test focused regression output.
- `quality/preview-pixel-inspector-qa/synthetic-native-alpha-rgba.png`: synthetic pixel evidence.
- `quality/preview-pixel-inspector-qa/synthetic-native-alpha-evidence.json`: native pixel evidence metadata.
- `quality/preview-pixel-inspector-qa/qa-manifest.json`: commands, final counts and SHA-256 hashes.
