# Final profile qualification

Frozen candidate SHA-256: `be527c529e013f706bfdc39b6970bbed3d2b0e33f75ac1f7c016cf6576a33b87`.

Frozen original SHA-256: `800751bc88f2539e51f742d57fe6287b44c2c2c8c74f958d297cf878790d579c`.

- Candidate aggregate: **48/48 passed**, 0 failed, 0 skipped (`all-candidate.tap`).
- Untouched frozen mobile control: **27/27 passed**, 0 failed, 0 skipped (`frozen-mobile.tap`).
- Candidate suite breakdown: 27 adapted mobile pure fixtures, 13 profile qualification tests and 8 independent review tests.
- Differential coverage: 300 authored plus 200 independent generated cases, comparing frozen-original/default/desktop plans and exact RGBA bytes.
- Actual maximum-size rendering: two 4096×4096 cases, each 16,777,216 pixels, byte-equal to independent integer source-over oracles. Original target pixels unchanged.
- Full-frame case: **100,696,077 work units**, above the original 100M ceiling and within fixed 256M desktop ceiling.
- Each maximum-target oracle case: **67,108,868 cumulative owned pixel-buffer bytes**, exactly matching **69,206,020 planned extra bytes minus the 2 MiB allowance**. This is not RSS or total pipeline memory.
- Mip-heavy allocation trace: every cumulative Float64 level plus decode/output matches planned bytes minus allowance.
- Cancellation before allocation and across decode/mip/copy/raster phases, real large-copy cancellation, platform-allocation failure and source atomicity passed.
- Exact selector, frozen isolated instances, default/asset caps, UMD exports, inherited/accessor metadata, unsafe buffers, overflow, edge/pixel thresholds and pre-allocation rejection passed.
- Test-only lowering of work/memory guards confirms rejection before pixel allocation; no public budget override is exposed or used.
- Original source remains at the frozen hash. Online/offline 0.2.7 installer hashes match their previously frozen values, recorded in provenance.json. No production sources or releases were edited by this task.

## Source delta

`source.diff` is the complete 12-added/6-removed-line diff. Only the explanatory header, private factory name, four fixed profile-selected limits, `createProfile` helper and export-list extension changed. Reverse-normalization reproduces the original bytes exactly; all validation and rendering math remains unchanged.

## Main artifacts

- `../image-overlay.js`: frozen candidate implementation.
- `../DESKTOP-PROFILE-CONTRACT.md`: human-readable API, safety, geometry and resource contract.
- `qualification-report.json`: exact large-case source/result/oracle hashes, recipes, plans and allocation trace.
- `independent-review.md` and `independent-review.tap`: independent review scope, reproducible tests and caveats.
- `../SHA256SUMS`: final integrity snapshot.

## Reproduction and scope

From the profile directory run `./run-qualification.sh`; no dependency installation is required. This refreshes result files, so re-snapshot checksums afterward if preserving the new run. The recorded runtime is v24.19.0. `node --check image-overlay.js` also passed.

This is an isolated shared-core candidate, not a production integration or release. Desktop UI/import/export/project replay, native decoder behavior, whole-pipeline budgets, Windows runtime and device performance remain outside this qualification. The core's synchronous cancellation is not an event-loop yielding guarantee.
