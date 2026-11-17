# Image-overlay release-content audit

Audited 2026-10-22. Candidate: application **0.2.8**, project **v16** (reads v1–v15). This is a source/stage/portable-ASAR/installer-payload audit, not Windows execution or release acceptance. No current-version Setup was compiled by this audit; generic Setup files in `installer/out` at the start of the audit were retained 0.2.7 builds, not evidence for 0.2.8.

## Result

**126 tests passed, 0 failed/skipped**: 9 new image-release checks plus 117 existing package-boundary, unpacked-runtime, installer-safety, path-regression and release-metadata checks. Command:

```sh
node --test tests/overlay-release-audit.test.cjs tests/backend-package-boundary.test.cjs tests/audit-unpacked-runtime.test.cjs tests/installer-audit-safety.test.cjs tests/installer-path-behavior.test.cjs tests/installer-release-metadata.test.cjs tests/release-sync.test.cjs
```

The nine new checks are in `tests/overlay-release-audit.test.cjs` and require an up-to-date stage, portable package and installer payload. They deliberately fail on stale packaged application bytes. They do not build, install, or modify production files.

## Verified actual contents

- `.build/app-win32` contains 200 files (78 application/content files and 122 dependency files) and matches the current source for all allowlisted application/backend files and all shipped `src`/`assets` files. The portable ASAR and installer payload ASAR have the same complete file inventory as the stage and the same file bytes, with the intentional exception of Electron Packager's removal of development/script fields from `package.json`. The installer payload manifest independently covers all 91 payload files.
- Both `dist/Mint Portrait-win32-x64/resources/app.asar` and `installer/payload/resources/app.asar` have SHA-256 **108ffadbf3bd4e11a658ced310da98dfcbccc728f053b19462cb085b4f036a20**.
- All four import modules are present and source-identical: `image-import.cjs`, `image-import-worker.cjs`, `image-import-decode.cjs`, `image-import-guards.cjs`. The new import path uses a **Node worker thread**, not an external executable: its default entry is `path.join(__dirname, 'image-import-worker.cjs')`. That entry's `sharp`, project-codec, decode, guard and Node built-in dependencies are accounted for in the package.
- All five renderer/core modules are present: `src/image-overlay.cjs`, `src/image-assets.cjs`, `src/image-layers.cjs`, `src/image-layer-session.cjs`, `src/image-layer-panel.cjs`. Packaged HTML loads each exactly once, in that order, before `app.js`. Evaluating their actual packaged scripts in a clean JavaScript VM creates all five expected browser globals without loading test helpers. This is initialization coverage, not a real browser interaction test.
- `src/project-document.cjs` in both ASARs evaluates to schema v16. Source/stage/portable/payload package identity and runtime dependencies agree with release metadata 0.2.8. The generated installed README identifies 0.2.8, describes local image overlays and the untagged 16-bit PNG correction, and states v16 writes/v1–v15 reads and lack of Windows acceptance.
- Both packaged decode paths, `image-import-decode.cjs` and `export-render-worker.cjs`, are byte-identical to source and contain the `meta.hasProfile` guard before input ICC conversion, followed by explicit sRGB/alpha conversion. This audit proves the fix is included, not its pixel correctness; the separate color-regression suite covers pixel behavior.
- Sharp **0.35.5**, `@img/colour`, `detect-libc`, `semver`, and `@img/sharp-win32-x64` are present with their required JavaScript dependencies. The native `.node` and both `libvips-cpp-8.18.7.dll`/`libvips-42.dll` are flagged unpacked in both ASARs, exist alongside them, match staged bytes and identify as Windows x64 PE files. The installer manifest hashes those exact files; generated verification and uninstall lists include them.
- No stage/ASAR inventory entries belong to tests, fixtures, QA, research, checkpoints, installer, tools, docs, `.venv`, or `assets/demo.png`. Application/source-module literal dependency references resolve to shipped files/packages or built-ins; no literal runtime reference points to tests/quality/fixtures. Test fixture availability is therefore not part of the audited runtime module graph.

## Preserved installer safety

The existing 0.1.1 regression suite still reproduces the historical missing-directory failure using its retained pre-fix fixture, then executes the current NSIS validator with mocked native APIs for installer and uninstaller paths. It accepts new/nonexistent directories, Unicode paths and normalized safe subfolders; rejects roots, relative/UNC/device paths, protected folders and target/ancestor reparse points; handles native errors without erasing the input; and leaves directory-page validation read-only. Empty existing folders are accepted; files and nonempty folders are rejected.

The existing safety suite also verifies fresh-only install rechecks, per-user identity, exact payload hashes, directory guards before deletion, exact nonrecursive uninstall allowlists, and retained user data. These are static and mocked-native checks, not proof of actual Windows install/uninstall behavior.

## Findings and scope limits

1. The initial `tools/verify-package.cjs` explicit top-level file list omitted the four import modules even though packaging included them. This was reported and corrected by the parent during the audit; the corrected list was read back. The new independent test enforces their presence in that verifier and covers all application allowlist files and every staged file rather than repeating the omission.
2. Source README/checkpoint progress documentation was being updated during the audit. Its final readback identifies 0.2.8 as an unreleased candidate, consistent with the current package. Installation metadata was independently checked against `release-config.json`, packaged manifests and the generated payload README, not historical delivered-version prose.
3. This audit does not execute Windows Electron, load Windows Sharp DLLs, exercise a worker inside Electron's ASAR implementation, compile/execute a 0.2.8 Setup, assess GPU/4060 performance, or establish SOTA portrait quality. Re-run these checks after any production change/repackage, then verify newly built Setup archives separately.
