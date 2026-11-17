# Rebuilding the Windows setup programs (installer 0.2.9)

These scripts were compiled on Linux with native NSIS 3.11. They create real Windows GUI installers, not renamed archives or script launchers. No signing certificate is included or created. Windows installation/launch/uninstallation still requires acceptance testing on an authorized Windows machine.

## Prerequisites and provenance

- Build the app from the enclosing source with `npm ci --ignore-scripts` and the Windows-codec preparation below, then `npm run build:win`. Dependencies are pinned by package-lock.json. Existing source assets contain the local MediaPipe models and WASM runtime.
- Electron 45.0.0 official Windows x64 runtime: https://github.com/electron/electron/releases/download/v45.0.0/electron-v45.0.0-win32-x64.zip . SHA-256: `ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47`.
- Linux NSIS compiler: https://deb.debian.org/debian/pool/main/n/nsis/nsis_3.11-1_amd64.deb . SHA-256: `e6eb6ffb70f0df09e95dedb2d2cf55ad3c2679f7c2ae357d0c00cc4c83178690`.
- NSIS standard includes/stubs: https://deb.debian.org/debian/pool/main/n/nsis/nsis-common_3.11-1_all.deb . SHA-256: `103a3284c1a5356efa0aba90fdfc391c3cde8e7df8726377cef0f98471584047`.
- Unmodified Unicode installer plugins: https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-resources-3.4.1/nsis-resources-3.4.1.7z . SHA-512 base64: `Dqd6g+2buwwvoG1Vyf6BHR1b+25QMmPcwZx40atOT57gH27rkjOei1L0JTldxZu4NFoEmW4kJgZ3DlSWVON3+Q==`. This digest is pinned in official app-builder-lib 26.15.3.
- Extract both Debian packages under `tools/nsis/root` using `dpkg-deb -x`. Extract the resource archive under `tools/nsis/resources`. No system-level installation is necessary.

## Build

From the project root:

1. Set `RUNTIME_ZIP` to the absolute path of the downloaded, pinned Electron runtime ZIP. Optionally set `ASAR_FILE` to the verified app.asar; otherwise it uses `dist/Mint Portrait-win32-x64/resources/app.asar`.
2. Run `python3 installer/prepare.py`. It verifies the runtime hash, constructs the fresh installation payload, and generates exact-path SHA-256 verification and uninstall deletion lists. It preserves the application's ASAR bytes.
3. Create `installer/out` if missing.
4. Run `NSISDIR="$PWD/tools/nsis/root/usr/share/nsis" tools/nsis/root/usr/bin/makensis -V3 installer/MintPortrait.nsi`.
5. Run the same command with `-DOFFLINE` before the `.nsi` path to generate the complete offline installer.
6. Run `node --test tests/*.test.cjs tests/manual-qa/*.test.cjs` and `node tools/verify-package.cjs`. Inspect the exact installer bytes and test them on Windows before relying on the build for production.

The online installer embeds the app and models and downloads only the pinned official runtime. The offline installer embeds every curated payload file. Both verify every staged file against their compiled SHA-256 values before committing the same-volume stage. The output is not guaranteed byte-for-byte reproducible because NSIS and app packaging record build metadata; the fixed runtime, model and application file hashes can be reproduced and checked.

Fresh installation only: old versions must be uninstalled first. No automatic elevation, forced process termination, security-policy change, service, scheduled task, startup entry, or auto-update service is used. Do not bypass operating-system warnings.

## 0.1.1 directory validation fix

The installer uses Win32 GetFullPathNameW, not the NSIS instruction of the similar name. The NSIS instruction clears its output when the requested new path does not exist; using it during directory validation caused the 0.1.0 false root-directory warning. The new call keeps input/output distinct, checks return and buffer size, preserves the input on rejection, and retains root/protected-directory/reparse safeguards. This directory-only 0.1.1 patch originally left application 0.1.0 payload unchanged. Unreleased development candidate 0.2.0 retains the fix and updates the shared retouch core and application version. See docs/INSTALLER-PATH-REGRESSION.md for behavioral test coverage and limits.

## 0.2.0 natural retouch repair

Hard-clipped polygon feathering and a direct white-blend brightening operation have been replaced by soft inward distance weights, adaptive skin-color/luminance protection, feathered feature exclusions and a bounded hue-preserving luminance lift. Multiple faces are unioned before one beauty pass. Model files are unchanged. See docs/SKIN-VISUAL-QA.md and the public QA assets for actual image comparisons and scope limitations. No private user screenshot is shipped.

## Native codec preparation added on 2026-10-22

Copy installer/windows-codec/package.json and package-lock.json into .build/win-deps, then run npm ci --prefix .build/win-deps --ignore-scripts --cpu=x64 --os=win32 --include=optional. Sharp0.35.5 and its official Windows native module are staged by an exact production-package allowlist. No Linux addon is shipped. The native addon and libvips DLLs are unpacked beside app.asar in resources/app.asar.unpacked; this directory must accompany ASAR_FILE. prepare.py embeds and verifies that complete tree, and generates shallow-first checks for all uninstall directory ancestors before any exact-path deletion. Dynamic native-library and third-party license files remain accessible in this tree.

Sharp source: https://github.com/lovell/sharp/tree/v0.35.5 ; libvips source: https://github.com/libvips/libvips/tree/v8.18.7 . Dependencies retain their own licenses. Windows DLL loading has not been executed here.

The current Setup is a development candidate, not the requested SOTA-quality remake. Do not publish or replace a prior delivered installer automatically. Existing compiled outputs may predate audit fixes; rebuild and verify after source changes. The source checkpoint excludes generated executables and full runtime payload, so payload-content tests require the preparation step above.


## Manual source checkpoint5

The delivered checkpoint5/0.2.0 development branch included manual selection/liquify/repair shared modules and project schema3. Build again after this checkpoint; earlier0.2.0 binaries do not identify an immutable source revision. Record exact ASAR, payload, online/offline Setup and source-archive hashes. No public QA portrait, test fixture, Python environment, SegFace/BiRefNet research weights or optional API credentials is included in the curated application payload. Learned research modules remain unavailable/quality-blocked rather than silently falling back under an AI label.


## 0.2.1 development patch

Adds shared five-node monotone/free master/RGB curves, eight-band HSL, accepted-preview-only sampled histograms, and project schema4 (reading1/2/3). These are explicit user-controlled conventional8bit sRGB color operations, not natural-beauty defaults or a SOTA claim. Fixes transparent-input manual liquify by rejecting it before edits/export rather than clipping a moved silhouette; no alpha-warp feature is claimed. Shared repair now has a resolution-independent conservative stroke budget so oversized strokes fail in the small preview rather than only during original-size export.

The original0.1.1 stable Library identities remain unchanged. New0.2.1 binaries replace only the development artifact versions. The installer still requires uninstalling an existing installation before a fresh install; save open projects first. It neither overwrites original photographs nor deletes saved projects or user preferences.

## 0.2.2 development bundle

This bundle adds original-preserving final crop/quarter-turn/flips, portable named adjustment presets and manual photo-review metadata/filtering to the previously tested tone/manual workflow. Project schema 6 reads1–5. Review does not constitute AI culling, EXIF editing or dual-photo comparison. User notes and originals remain unchanged by uninstallation; save projects and uninstall the old program before reinstalling.

For a strictly local rebuild with the already verified runtime, set `ELECTRON_ZIP_DIR` to its containing directory and run `node tools/package-win.cjs`. The script verifies the exact pinned ZIP SHA-256 and passes Electron Packager its official electronZipDir option, avoiding a runtime download. No npm invocation is needed for this step or the direct Node tests. Installer PE fixed and string versions are checked against package/NSIS metadata by tools/verify-installer.py. These are static Linux build/extraction checks, not Windows execution.


## 0.2.3 development bundle

The candidate combines Levels and portable preset v2/project v7 migration, the manual-liquify-to-final-framing bug fix, frozen reference comparison, opt-in RGBA preview inspection, and opt-in two-generation local recovery. Recovery contains full originals/history locally, is unencrypted and disabled by default, and never marks a formal project save complete. The app enforces a single instance for its user-data profile. Existing startup drafts require an explicit choice before new automatic rotation. Unknown commit results pause automatic retry. These features do not establish SOTA retouch, browser acceptance, Windows installation acceptance or zero-loss crash recovery.

The same official pinned Electron runtime and SHA-256 remain in use. Exact executable sizes, hashes and source/payload versions must be read from the newly generated validation reports, not older 0.2.2 reports. No new signing identity or distribution endpoint is introduced. Save projects and uninstall the prior app before reinstalling; exact-owned-file uninstall preserves user AppData, including recovery drafts and named presets.


## 0.2.4 development bundle

Includes reversible final-canvas border/padding, up to8 editable system-font text layers with projectv9 (reads1–8), and optional final-file long-edge downsize after completed effects/framing/padding/text. Text final composition remains capped16MP; a small output cannot bypass source/intermediate limits. Native Sharp uses a separate raw Lanczos3 resize before output alpha cleanup and JPEG white flatten. Font measurement remains in the same renderer for preview/export, not native Sharp. No fonts, research weights, model environments, QA photos or new dependencies are installed.

0.2.4 retains the directory validation and exact-owned-file uninstall safeguards. Existing install must be closed and uninstalled before reinstalling; AppData recovery/presets and user project/photo files are not deleted. It remains unsigned and Linux-built, not Windows runtime accepted or completed SOTA retouch. See current payload/installer hash reports rather than older0.2.3 metadata.


## 0.2.5 development bundle

Combines the neutral-default light-balance/linear RGB white-balance controls and the input-stage neutral-region sampler with deterministic manual final-canvas mosaic and opaque-cover layers. Both preview and original-size native export replay the same bounded redaction recipe after framing/padding/text and before final downsize. Project v11 reads v1–v10, and portable adjustment preset v3 reads v1/v2. Presets never carry redaction, selections, photo identities or geometry. Existing redaction, including hidden layers, prevents incompatible geometry changes; selected opaque cover rejects feathered source masks. See docs/LIGHT-BALANCE-DESKTOP-UI.md, docs/REDACTION-DESKTOP-UI.md and docs/REDACTION-PIPELINE.md for exact capabilities and limits.

Mosaic is not reliable anonymization, and opaque cover is not secure deletion. Originals, embedded project originals, undo history and optional unencrypted local recovery retain the covered content. Share only the inspected final export, not an editable project or original. JPEG and final downsize can change edge pixels; choose PNG with no downsize when exact opaque pixels matter and still inspect the actual output. No new dependency, research weight, credential, signing identity, service or upload endpoint is introduced.

This release preserves the 0.1.1 directory validation fix, product identity, install path and exact-owned-file uninstall guards. Close and uninstall the previous version before reinstalling; user AppData, recovery/presets, projects and photos remain untouched by uninstall. Retained 0.2.4 artifacts are not replaced. The candidate remains unsigned and Linux-built: package, source/payload parity, archive extraction, PE metadata/security flags and regression checks are not Windows execution, desktop/UI usability acceptance or a SOTA-quality claim. Newly generated release/checkpoint manifests identify these precise 0.2.5 bytes.

For this already provisioned build, no dependency installation or download is required. Use the pinned cached Electron ZIP by setting ELECTRON_ZIP_DIR and invoking node tools/package-win.cjs directly; then run installer/prepare.py, both NSIS builds and the current verification scripts. The versioned distribution files are MintPortrait-Development-0.2.5-Setup.exe and MintPortrait-Development-0.2.5-Offline-Setup.exe.


## 0.2.6 development bundle

Adds source-validated painting layers and explicit per-person controls to the0.2.5 base. Source schema13 reads1–12. Keep the exact product identity/path/uninstaller guards, pinned official158,223,852-byte Electron45 runtime and Windows Sharp dependencies. No new download or dependency installation is needed in the provisioned cloud build. Build both normal and -DOFFLINE NSIS targets; the versioned output names are MintPortrait-Development-0.2.6-Setup.exe and MintPortrait-Development-0.2.6-Offline-Setup.exe.

Per-person controls are classical processing with existing learned landmarks, up to5 explicit faces, zero defaults, no identity tracking and fail-closed overlap/resource/geometry guards. No real group-photo generalization, Windows/browser/4060 performance or SOTA quality claim follows from the cloud tests. Painting erases only its own layer; project originals/history remain intact. The full QA-only portraits/tests are excluded from package staging.

## Unreleased 0.2.7 source checkpoint

The next source candidate adds shared arbitrary-angle straighten and writes project schema14, reading1–13. No0.2.7 Setup has been generated or delivered at this checkpoint. Internal ASAR/payload refresh is validation only; remove the unbuilt-candidate notice only when actually producing the next bundle. Frozen0.2.6 EXEs remain in the separate release directory and existing Library versions.
