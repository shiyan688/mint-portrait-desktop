# Windows installer safety audit

Historical 0.1.0 audit below. Its static checks did not catch the nonexistent-path behavior of the NSIS GetFullPathName instruction. Installer 0.1.1 fixes that defect; the current regression methodology and review are in INSTALLER-PATH-REGRESSION.md. The original snapshot below is retained for traceability, not as validation of the new binary.

Static safety review completed on 2026-10-21. The checked source and payload pass the regression suite. This is not a Windows execution certification: installation, launch, download interruption, and uninstall still require the Windows acceptance checks below.

## Scope

- Per-user Windows x64 installation of Mint Portrait 0.1.0.
- Online setup embeds the application and downloads a pinned official Electron runtime.
- Offline setup must install the equivalent application without a runtime download.
- Installation is deliberately fresh-only: an existing registered install must first be uninstalled, and the selected destination must be absent or empty. In-place upgrades are not implemented or claimed.
- Uninstall must preserve photographs, exports, application user data, and files not owned by the installer.
- No code signing credentials, external publication, security-policy changes, or access to a user's computer are part of this audit.

## Review gates

1. Source integrity: the online runtime uses an exact versioned official HTTPS URL and a fixed SHA-256; verification precedes extraction or execution. The offline payload and embedded application match the verified package.
2. Scope and paths: use the current user, not HKLM or all-user shortcuts. Reject roots and unsafe destinations in the actual install operation, including silent and command-line directory overrides. Do not expand user-provided paths as executable shell code.
3. Installation transaction: reject existing installs, preserve unknown files, serialize conflicting setup instances, detect running applications, stage and verify on the destination volume, check required metadata writes, and commit only to an absent or empty destination.
4. Failure and cancellation: network errors, invalid hashes, extraction failures, locked files, permission failures, and cancellation must not leave a false successful install or destroy a working previous installation. Recovery must be described accurately.
5. Uninstall: verify installation identity, delete only validated installed-file paths, do not follow directory junctions or other reparse points outside the installation, remove only empty directories, and retain registration if removal is incomplete.
6. Registration: quote the uninstall command, use current-user Start Menu and optional desktop shortcuts, and avoid removing shortcuts or registry entries belonging to a different installation.
7. Product honesty: identify the unsigned test build, the runtime download requirement of online setup, and the absence of Windows execution and end-to-end model-inference validation.

## Windows acceptance checks still required

- Clean standard-user installation on supported Windows x64, followed by launch.
- Install to a Unicode path with spaces and punctuation; verify shortcuts and uninstall.
- Attempt a drive root, share root, unrelated nonempty folder, and path containing a junction.
- Test offline setup with network disabled and online setup with a blocked or interrupted runtime download.
- Reinstall with the app closed and while it is open; open a second installer concurrently.
- Cancel before installation and during an interruptible operation; verify the stated recovery behavior.
- Simulate full disk, denied write access, a locked installed file, and a checksum mismatch.
- Put photographs and unknown files at the installation root and in a nested directory; verify that uninstall preserves them.
- Verify uninstall from Windows Settings and Start Menu, including after moving or deleting an installed file.
- Inspect Windows trust and reputation warnings without disabling protections or bypassing organization policy.

## Primary references

- [NSIS scripting reference](https://nsis.sourceforge.io/Docs/Chapter4.html): file operations, installer callbacks, execution level, shell context, and the explicit warning against recursive deletion of the installation directory.
- [NSIS command-line usage](https://nsis.sourceforge.io/Docs/Chapter3.html): silent installation and directory overrides.
- [NSIS uninstall registration](https://nsis.sourceforge.io/Docs/AppendixD.html): per-user registry entries and quoted uninstall commands.

## Findings and verification

### Verified

- The full source/package regression suite passed: 92 tests, zero failures, zero skipped tests. Thirteen tests in `tests/installer-audit-safety.test.cjs` specifically cover the installer. These tests inspect source and packaged bytes, not a simulated Windows install.
- The staged payload contains 77 files totaling 419,860,502 bytes. Every file's size and SHA-256 matches `installer/payload-manifest.json`; there are no unlisted files, duplicate case-insensitive paths, or symbolic links.
- `resources/app.asar` matches the previously packaged application byte-for-byte. Its SHA-256 is `770d3de56d2f04e1a72a47517b8579d37c04763e8913736cda87542e2ec8cc46`.
- The online path uses the exact official Electron 45.0.0 Windows x64 HTTPS archive and its pinned SHA-256, then verifies all final application files before committing the installation directory. Offline setup uses that same generated payload.
- The uninstall file list is compiled from the curated build payload. It uses individual file deletion, followed by nonrecursive removal of empty directories, rather than deleting the destination recursively. AppData, photographs, exports, and unknown files are not targeted.
- Setup uses the current user and does not request administrator elevation, kill application processes, run PowerShell/CMD, weaken certificate checks, alter execution policy, disable sandboxing, or request a reboot.
- The online artifact was recognized as an NSIS 3 Unicode Windows GUI executable in the build's archive inspection. Independent PE inspection confirmed an `asInvoker` manifest, and the stored NSIS CRC matched the executable body.

### Defects found and fixed during review

1. The directory-page leave callback was accidentally attached to the Welcome page. It is now attached immediately before the Directory page.
2. A missing resource or locale directory was incorrectly interpreted as a reparse point, preventing retry after partial uninstall. Attribute failure is now handled before checking the reparse bit.
3. Uninstaller creation and installation-marker writes were unchecked. They now check write errors, executable presence, and marker readback before directory commit.
4. Uninstall validation originally ran only before the user entered the wizard. Path, ownership, and application state are now revalidated at the actual deletion section.
5. Shortcut ownership flags were recorded even when shortcut creation failed. They are now recorded only after successful creation; existing same-named shortcuts are not overwritten.
6. Final metadata deletion could leave an installation record without a usable uninstaller. The executable and original marker are now backed up privately; deletion and registry cleanup failures retain or restore the retry path. Restoration failure is reported explicitly rather than presented as success.
7. The application packaging ignore list did not exclude the new installer workspace. It now excludes it to prevent future builds from recursively embedding setup executables and payloads into the application archive.

### Remaining verification limits

- No Windows executable was launched in this audit. Real Windows setup pages, shortcuts, Settings registration, process detection, network cancellation, permissions, file locks, and uninstall behavior remain unexecuted.
- The installer is unsigned. Static integrity checks do not establish publisher trust or predict Windows reputation warnings.
- A sequence of filesystem and registry operations cannot guarantee recovery from arbitrary power loss or concurrent external tampering. The installer uses conservative checks and explicit errors, but those recovery paths still need Windows testing.
- Third-party notices are bundled; this audit does not provide a legal license-compliance opinion.

### Reviewed snapshot

- `installer/MintPortrait.nsi` SHA-256: `45da12194481e0af5c79e1b5f974a5e736aab3066ea17aa847ac8c0f4c55c3b9`
- `installer/payload-manifest.json` SHA-256: `75f06b3fcd1ecfe64a8b9b5c2b932a004ebe143ba7a6947b9a9130254207e730`

Re-run the full suite and update this snapshot if the installer source or payload changes after review.
