# Installer 0.1.1 validation, 2026-10-21

## Corrected defect

A normal new installation folder was wrongly rejected with a disk-root warning. NSIS GetFullPathName requires an existing path and clears its result on failure. The validator then interpreted the empty result as a root. Installer 0.1.1 now calls Win32 GetFullPathNameW for lexical normalization, validates its return value before use, retains the entered path on rejection, and keeps root/system-folder/reparse protections. The installer UI identifies this fix as 0.1.1; application and model payloads remain 0.1.0 unchanged.

## Verified

- 174 automated tests pass: 79 existing application tests, 13 existing installer static/integrity tests, and 82 actual-source NSIS behavioral-model regressions.
- The regression interpreter executes the checked-in validator instructions and models documented native API contracts. It reproduces the previous missing-directory failure and covers new/default/Chinese paths, existing empty/nonempty/file targets, short child folders, trailing separators, dot-dot normalization, root/system/UNC/device/reparse rejection, native failure/overflow, register preservation and read-only/cancel-safe validation.
- The native installer compiles as NSIS 3 Unicode PE32 GUI, with an x64 application and asInvoker execution level. It does not request administrator elevation. The PE certificate directory is empty (unsigned).
- The online setup passes archive testing and extraction. All five embedded product files match the original manifest, including the complete app/model ASAR SHA-256 770d3de56d2f04e1a72a47517b8579d37c04763e8913736cda87542e2ec8cc46.
- All 77 staged payload files retain their original SHA-256 values, 419,860,502 bytes total.

## Not verified on native Windows

These are Linux-hosted tests with mocked native boundaries, not an actual Windows install. Windows API behavior, installer page rendering, download cancellation, file locks, permissions, shortcuts, registration, application launch, end-to-end model inference and uninstall still need native Windows acceptance testing. The earlier user screenshot confirms the old directory-page defect, not a successful application launch.

Fresh-only/upgrade rejection, download-cancel handling and owned-stage cleanup are unchanged and remain covered by source checks. No Windows end-to-end upgrade or cancellation claim is made. Do not bypass operating-system warnings or organization policy.

See INSTALLER-PATH-REGRESSION.md for sources, precise test scope and limitations, and installer/BUILD.md for rebuild instructions.

## Online artifact

MintPortrait-Setup.exe: 7459274 bytes, SHA-256 `25c58a7eb3e19b9a6c99c35ad5b33725e85c1923451f213766574ea679e87b3a`. Installer UI/version: 0.1.1. Application archive remains unchanged.

## Offline artifact

MintPortrait-Offline-Setup.exe: 119191220 bytes, SHA-256 `337451a4c3d14d581eb583685945cb9070ee6605dc1905aa4fe3ea6f3c86fe6a`. Installer version 0.1.1 confirmed in PE version data. The completed archive passed testing and extraction; all 77 product files match the same unchanged manifest. This is archive integrity validation, not native Windows execution.
