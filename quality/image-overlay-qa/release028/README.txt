Mint Portrait 0.2.8 independent artifact audit

Run from any directory, with the finalized same-release Setup outputs and the original immutable source tree:
  bash /path/to/release-0.2.8/audit/reproduce-audit.sh /path/to/MintPortrait-Source /path/to/release-0.2.8

Needs the already cached Node ASAR library, Python 3 standard library, dpkg-deb, official NSIS/7-Zip cached packages, and pinned Electron runtime ZIP under /tmp/mint-electron-cache. It does not install or download tools or execute Windows binaries. It writes only reports/logs in this audit directory and the parent artifact-audit.json.

Scripts are adapted from 0.2.7 with explicit 0.2.8 ASAR/manifest pins, project v16, current overlay/import modules and installed documentation, finalized artifact directory arguments, immutable input checks, and concise summary generation. The exact product allowlist is 19 online files or 91 offline files, plus the separately inspected generated uninstaller. Compiler auxiliary files are checked independently and are not included in product counts.

The packaged launcher is app-branded 0.2.8.0; the actual installation payload launcher is byte-identical to official Electron 45.0.0 electron.exe and correctly retains 45.0.0.0 PE metadata. Setup and the installed ASAR package metadata declare app 0.2.8. The source-executing directory harness mocks Win32 APIs and is not a Windows installation test.

Passed static checks do not establish Windows installation, launch, native DLL loading, download/cancel UI behavior, uninstall success, security acceptance, image-quality acceptance, or GPU performance. These remain unsigned development installers.
