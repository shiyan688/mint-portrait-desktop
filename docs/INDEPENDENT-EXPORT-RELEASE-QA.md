# Independent desktop export release review

Reviewed 2026-10-22. This report concerns the development candidate, not a production or beauty-quality acceptance.

## Findings corrected before final packaging

1. **High: nested unpacked-runtime paths were not protected during uninstall.**
   The new Sharp payload introduces `resources/app.asar.unpacked/node_modules/@img/...`, but the previous uninstall checks covered only `resources` and `locales`. Replacing an intermediate child directory with a junction could redirect an exact-path deletion outside the installation. The installer owner added generated, shallow-first guards for all eight payload ancestors before any removal. Reparse points and unexpected attribute-read failures abort; already-missing paths remain retryable. Independent manifest-driven tests verify complete coverage and guard order. This is source/package verification, not a native Windows junction execution test.

2. **Medium: cancelling Quit permanently disabled the export service.**
   `before-quit` disposed singleton services before the window's unsaved-project confirmation could cancel quitting. The app could remain open with subsequent exports rejecting as closed. Disposal now occurs at `will-quit`. The regression test performs a real Sharp-worker export, reproduces Electron's before-quit/close-cancel event sequence, then performs another real export. It also checks that the backend remains available until actual termination.

3. **Medium: a clean project could close during active export processing or file commit.**
   The original close guard considered project saves, but not native export rendering or atomic image writes. Closing now waits for active exports; the user can stop a render from the queue and close afterwards. A tracked write is not cancelled in the middle of its commit. Tests cover clean-project quit while rendering, queue cancellation, blocked closing during a real atomic save, successful save preserving a pre-existing file, and guard release after a failed write.

4. **Medium: genuine animated PNG input silently exported only its first frame.**
   A synthetic two-frame APNG was accepted because Sharp's PNG metadata omitted `pages`. The initial native render returned a static PNG despite the intended multi-frame rejection. Validated PNG chunks are now inspected for APNG animation control/frame chunks before rendering. The regression uses the genuine synthetic APNG, verifies rejection and unchanged source bytes, then successfully exports a normal PNG with the same service.

## Verification performed

- Final source snapshot: `npm test`, **510 passed, 0 failed, 0 skipped**.
- New tests: `audit-export-lifecycle.test.cjs`, `audit-animation-export.test.cjs`, and `audit-unpacked-runtime.test.cjs`.
- Existing coverage includes queue cancellation during render and write, retries without duplicate successful files, explicit original/working dimensions, stale source/mask rejection, v1 project migration, v2 local-layer round trips, missing required face/mask failures, transparent RGB sanitization, JPEG flattening, and local-layer controls through executable DOM/IPC doubles.
- Verified the actual unpacked Windows Sharp addon and both libvips DLLs are x64 PE files, match payload manifest lengths/SHA-256 values, and appear in generated integrity and exact-removal lists. This verifies packaging contents, not successful native loading on Windows.
- Inspected actual pixels in the public 5412×7216 comparison. The displayed result shows a mild manually masked exposure lift. The associated measured report records original bytes unchanged, no scaling, and zero changed pixels outside the selected mask. This is evidence for full-resolution local editing, not learned beauty or SOTA quality.

## Explicit limits

- No native Windows install, application launch, DLL loading, actual quit event sequence, junction behavior, or uninstall was executed here. Lifecycle UI tests use Electron event doubles with real image-render workers and real atomic filesystem writes where stated.
- Chromium launch was previously blocked by this environment. It was not retried with security bypasses. DOM/IPC tests are not visual browser acceptance.
- No additional private photos, paid APIs, model downloads, GPU inference, or private uploads were used for this review.
- The image pipeline is 8-bit sRGB; output drops original EXIF. Basic tone/local layers are bounded to 64 MP and 16384-pixel edges; portrait/heal/background operations remain bounded to 16 MP. Explicit working-size mode is not full-resolution processing.
- The natural/Asian-style controls remain optional classical algorithms guided by landmarks. No ethnicity inference, commercial-retouch parity, or SOTA beauty-quality acceptance is established by these tests.
- Final distribution archives must be rebuilt from the corrected source and their payload hashes regenerated. This review does not claim that an older archive contains these fixes.
