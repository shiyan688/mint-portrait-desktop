# Desktop 0.2.9 candidate: independent compiled-artifact audit

Status: **passed**. Audit UTC: 2026-10-22T21:45:59.095918+00:00.

This is a read-only artifact/source audit of a development candidate, not a release or Windows/quality acceptance. Only this JSON/Markdown audit pair was added to the source tree; extraction used temporary directories, removed afterward. No Windows binaries were executed.

## Frozen candidates

- Online: `MintPortrait-Development-0.2.9-Candidate-Setup.exe`
  - 13,937,726 bytes; SHA-256 `1124326ff94364bba065c7b7955ce34148913fb511fa75afe8608637b01c1f2c`.
  - Exact manifest product set: 19 files verified by byte count and SHA-256. NSIS-generated `Uninstall.exe` is accounted for separately; only expected installer support plugins were outside the product root.
- Offline: `MintPortrait-Development-0.2.9-Candidate-Offline-Setup.exe`
  - 125,735,431 bytes; SHA-256 `9f87ef13300e7a30f0af4655b9ba58d74a2dfb28ca303d0812f92a45cbd30890`.
  - Exact manifest product set: 91 files verified by byte count and SHA-256. NSIS-generated `Uninstall.exe` is accounted for separately; only expected installer support plugins were outside the product root.

## Independent validation

- PE headers and actual resource directories were parsed independently, not inferred from file names or prior verification reports. Setup and generated uninstaller are x86 GUI PE32, unsigned, asInvoker, fixed file/product version 0.2.9.0; string file version 0.2.9.0 and product version 0.2.9.
- Existing local 7-Zip performed integrity testing and inert NSIS extraction. No Windows install, launch or uninstall, network request, download, or dependency installation was performed.
- Each ASAR contains 201 exact staged application/production entries. Independent pickle/JSON-header parsing verified sizes, packed offsets, external unpacked entries, file SHA-256 integrity and integrity blocks. All application files equal current source; every production dependency file equals the prepared production tree. Packager-normalized package metadata is checked explicitly.
- ASAR SHA-256: `29df72c3ded9ffc7858b70cf4342c21b17c9561ba1c124b53dc88779cac186cf`.
- `src/perspective.cjs` SHA-256: `3a3b57ea8da4ce4a7c99b180a454e9f00a4242a0460621d267ad5487fbe66557`. Source and both packaged copies match the pinned implementation.
- All 170 scanned relative CommonJS, ES-module, HTML-script, worker/importScripts and local resource references resolve. The only bare application imports are Electron, Sharp and Node built-ins. This is static literal closure, not a claim to arbitrary dynamic-code execution coverage.
- Unpacked Windows x64 Sharp addon and both libvips DLLs are present, have x64 PE headers, and match exact manifest/source-production hashes. Production package identity remains Sharp 0.35.5.
- No installed tests, quality/research directories, fixtures, tools, docs or demo image. All 190 unique QA/test image fingerprints were compared against installed ASAR entry bytes with zero matches. The backend allowlist contains only catalog, SegFace mask helper and manifest; no Python environment or research weights are installed.
- Installed 使用说明.txt states 0.2.9 development candidate; project format 17/read 1–16; explicit four-corner draft, Apply/Cancel, undo, stage order and geometry restrictions; no silent downsampling, no AI/lossless claims, and no Windows/4060/SOTA acceptance. The prior retained straighten stage-order omission was corrected and both rebuilt installers verified.
- Source README now leads with 0.2.9 candidate/schema17 and four-corner controls. Source README is not installed.

## Fail-closed boundary

- main.cjs, preload.cjs, desktop-ai.cjs, desktop-backend.cjs, backend/catalog.cjs, src/backend-panel.js and src/backend-contracts.cjs remain byte-identical to frozen 0.2.8 source, and the same bytes are in the candidate ASAR.
- Main-process IPC remains bound to the trusted window/main frame and app origin; renderer network requests stay restricted to local schemes. Missing backend runtime/assets remain reported unavailable. The model panel requires an available runtime, ready model, approved license and available explicit device; inference rejects non-ready models/devices instead of silently falling back.
- `node --test tests/backend-panel.test.cjs tests/backend-package-boundary.test.cjs tests/desktop-ai.test.cjs`: 20/20 passed; zero failures, cancellations or skips.
- `node --test tests/desktop-backend.test.cjs`: 39/39 passed; zero failures, cancellations or skips.

## Offline runtime identity

- 72 unchanged runtime files independently match the existing cached Electron ZIP with SHA-256 `ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47`.
- Installed MintPortrait.exe is the intentionally renamed, unmodified Electron 45.0.0 x64 GUI runtime PE, not a PE stamped with app version 0.2.9. Application version is from ASAR package metadata; Setup/Uninstall PE versions are separately 0.2.9.0. Online and offline installed application ASARs are byte-identical.

## Preserved 0.2.8 release

- `MintPortrait-Development-0.2.8-Setup.exe`: 13,930,379 bytes; SHA-256 `3c60dcb0fd0096099429fa7749d47ac83ba4d003f6314100155f0601d07f24c9`. Matches the pinned original. No old release files were changed.
- `MintPortrait-Development-0.2.8-Offline-Setup.exe`: 125,696,680 bytes; SHA-256 `99be15c186acc799634a7dfb2760ba2abc23714cbcd25bc02e4f185c31ebaf8f`. Matches the pinned original. No old release files were changed.

## Boundaries

- No Windows installation/startup/uninstallation, real-browser visual validation, GPU/4060 benchmark or accepted SOTA portrait-remake claim.
- Source full-suite counts and other image-quality evidence are outside this audit; only the focused tests listed above were independently rerun here.
- Full per-file fingerprints, PE resources, resolved reference edges and test-log hashes are in compiled-artifact-audit.json.
