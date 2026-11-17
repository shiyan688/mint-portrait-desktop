# Unreleased learned-integration source overlay

This is source and public-test evidence, **not an installer or a runnable bundled model package**. It does not replace the previously delivered Setup.exe.

## Restore

1. Start with the full `MintPortrait-Installer-Source-0.1.0.zip` source tree (Library file `libfile_409356280a8c8191a5bf3fd3cbdffe91`, version 1). Despite that historical filename, its installer sources include the 0.1.1 path-validation repair.
2. Extract this checkpoint over that `MintPortrait-Source` directory, preserving relative paths. This overlay supplies the latest app/pixel/backend/tests/docs and public fixtures; the base archive supplies the unchanged bundled Electron-front-end/MediaPipe assets.
3. Check every included file against `CHECKPOINT-FILES.json`. The archive deliberately omits dependency environments, downloaded model weights, compiled binaries and most large raw inference planes. It contains no private user photograph.
4. See `docs/LEARNED-INTEGRATION-CHECKPOINT.md` for what actually ran, what is blocked and what is not implemented. See `checkpoints/python-runtime-freeze.txt` for the evaluated cloud CPU dependencies. This is not a claim that the same environment is bundled or validated on Windows.

SegFace and BiRefNet author code, asset manifests, license notices and exact weight hashes are retained. Weights are not silently fetched or executed by extraction. Reproduction requires separately installing the official runtime and obtaining the exact weights at the official project URLs documented in the adapter manifests. The evaluated research versions and their public sample outputs do not establish a general quality or commercial-distribution guarantee.

The parser is an experimental diagnostic capability. BiRefNet remains quality-blocked in the trusted catalogue. Foreground color estimation is an explicit, separately tested optional operation; the current UI rejects that optional result plane rather than silently ignoring it, and corrected alpha must be re-estimated before reuse. API adapters remain off and no credential is included.

## Tests and missing build artifacts

The Node source/unit tests include authored DOM/IPC doubles, exact pixel tests and process-boundary tests. They are not native Windows or real browser tests. The actual public model runs are identified separately in the quality reports.

`npm test` also includes two installer-payload inventory/disclosure tests. They require a compiled `installer/payload` tree, which is intentionally absent from the source checkpoint. The final test summary records these as missing-build-artifact failures or explicit source-only skips, never successful installer validation. Do not create fake payload files just to make the suite green.

Full-resolution/RAW/color-managed editing, dedicated trained skin/blemish retouch, accepted hard-case matting, packaged optional runtimes, Windows lifecycle validation and broader feature parity remain unfinished. No new Setup.exe is included or claimed.

The later project-persistence milestone adds `.mintproj` native local save/open. See `docs/PROJECT-FORMAT.md`, `docs/PROJECT-IO-SAFETY.md` and `docs/PROJECT-UI-QA.md`. Original compressed bytes are embedded, not references that grant arbitrary path access. This is manual save, not autosave or mobile interchange. Real filesystem/output roundtrip evidence is in `quality/project-roundtrip/report.json`.
