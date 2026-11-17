# Reproducible release metadata

`release-config.json` is the canonical **build release version and channel**. The only currently supported channel is `development`, rendered as 开发候选版. It is not a quality-acceptance status. Historical source-checkpoint reports belong in CHECKPOINT/README/checkpoints, not the installed user README.

For an explicitly authorized new release:

1. Edit only the canonical version/channel, then run `node tools/sync-release.cjs --write`. The helper changes only the fixed package/lockfile versions, four NSIS version records and BUILD header, preserving unrelated and historical text. It does not install dependencies, compile, sign, publish or upload.
2. Run the normal approved `npm run build:win`, then `python3 installer/prepare.py`. The installed README uses release-version/channel placeholders and derives the project schema from the actual codec. Source-checkpoint progress text is not copied into the installation.
3. Run `node tools/sync-release.cjs --check` (the default mode is also read-only). This rejects stale generated versions and transient statements such as a Setup not having been generated. Before preparation, `--write` intentionally does not claim an old payload is current.
4. Run full application tests, current package/payload/static safety audits, and the installer structural checks. Only then compile the approved Setup variants. Keep source and payload frozen during compilation. Signing, publishing, credentials or user-machine execution are separate actions and are not authorized by this helper.

The Electron URL/hash and dependencies remain separately pinned; changing the application version does not authorize replacing those components or weakening their integrity checks. A development channel never implies Windows, GPU, portrait quality or SOTA acceptance.
