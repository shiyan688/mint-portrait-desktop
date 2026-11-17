# Legacy regression refresh for project schema 13

Date: 2026-10-22 (UTC)

## Result

All existing top-level regression tests in this work scope pass: **2,390 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**. Runtime was 16.14 seconds. The two new per-person test files and `tests/manual-qa/` were deliberately excluded from this run because they are separate validation scopes, not because of a known failure.

This work modified 25 existing test files and this report. It made no production-code, tool, binary-fixture, dependency, model, or manual-QA changes. No model downloads, network/browser operations, or private photographs were used. Results describe cloud Node execution with existing native/Sharp tests and deterministic DOM/worker harnesses; they are not Windows installation or interactive browser QA.

Environment: Node v24.19.0; Sharp 0.35.5; libvips 8.18.7.

## What changed and what stayed strict

- Updated only assertions about the current codec version, newly encoded headers, restored document version, and current application snapshots from 12 to 13. Existing historical fixture input versions, legacy migration ranges, recipe versions, byte/source invariance, ownership, undo/redo, cancellation, and fail-closed assertions remain in place.
- Changed the unsupported-version sentinel from the now-supported 13 to `P.VERSION + 1`, retaining zero and 99 rejection tests.
- Added 12 genuinely rehashed historical-container tests (versions 1 through 12): missing `faceAdjustments` becomes explicit null in current, committed, every undo/redo recipe, and exported settings. They also check the original historical header version, unchanged encoded bytes, retained existing recipe fields, valid learned-cache metadata and Float32 planes, and immutable original source bytes.
- Added five slot-specific schema-13 tests requiring an explicit `faceAdjustments` field in both encode and rehashed decode. The same five tests separately construct real version-12 containers and prove that version 12 still requires `paintLayers`; historical requiredness was not silently moved to the new schema.
- Repaired the audit DOM mock using normal child append/remove/replace semantics, rather than changing production behavior to tolerate an incomplete mock. All 12 original audit tests, including both export-cancellation races and stale rendering/decoding, remain intact.
- Updated source-level inspector order/open-state assertions for the people section and added all eight new control IDs, including cancellation. Existing unique-ID, label-target, layout, and scrolling assertions remain.
- Made the worker mock implement standard multi-argument `importScripts`. Both per-person modules are added to its exact-file allowlist; unexpected imports still fail.
- Adjusted the intentional geometry-binding expansion to the public limit: exact-limit structural acceptance, one-character-over-limit rejection, and generation-time rejection of an otherwise-valid manual/selection recipe whose binding is larger than the current limit. Cycle, metadata-count, source, geometry, and malformed-data checks remain intact. No arbitrary unlimited string acceptance was introduced.
- Did not change any sync, preset, exposure, tone, or other editing-result expectations to hide failures. The separately rerun unchanged sync/UI/preset tests pass after the integration owner's production fixes.

## Executed checks

1. DOM/worker/geometry boundary subset: **56/56 passed**, zero failures/cancellations/skips.

   `node --test tests/audit-ui.test.cjs tests/desktop-layout.test.cjs tests/pipeline.test.cjs tests/redaction-layers.test.cjs`

2. All 25 changed regression files: **725/725 passed**, zero failures/cancellations/skips; 10.86 seconds.

   `node --test --test-reporter=tap` followed by the 25 test paths listed below.

3. Unchanged sync/UI/preset regression subset: **327/327 passed**, zero failures/cancellations/skips; 1.49 seconds.

   `node --test --test-reporter=tap tests/advanced-tone-ui.test.cjs tests/geometry-ui.test.cjs tests/learned-ui.test.cjs tests/manual-tools-ui.test.cjs tests/project-ui.test.cjs tests/preset-ui.test.cjs tests/preset-independent.test.cjs tests/export-layer-ui.test.cjs`

4. Every existing top-level regression except the two independently owned new per-person files: **2,390/2,390 passed**, zero failures/cancellations/skips; 16.14 seconds.

   `node --test --test-reporter=tap $(find tests -maxdepth 1 -name '*.test.cjs' ! -name 'portrait-people-desktop.test.cjs' ! -name 'portrait-people-workflow-independent.test.cjs' | sort)`

The counts overlap and must not be added together. No true production failure remains in these completed runs. The new per-person tests, manual QA, packaging, and Windows/browser execution are outside this report's result.

## Changed regression files

- `tests/advanced-tone-integration.test.cjs`
- `tests/audit-ui.test.cjs`
- `tests/desktop-layout.test.cjs`
- `tests/geometry-independent.test.cjs`
- `tests/geometry-integration.test.cjs`
- `tests/levels-contracts.test.cjs`
- `tests/levels-independent.test.cjs`
- `tests/levels-ui.test.cjs`
- `tests/light-balance-integration.test.cjs`
- `tests/padding-independent.test.cjs`
- `tests/padding-project.test.cjs`
- `tests/padding-ui.test.cjs`
- `tests/paint-integration.test.cjs`
- `tests/paint-ui-independent.test.cjs`
- `tests/photo-review-independent.test.cjs`
- `tests/photo-review-project.test.cjs`
- `tests/photo-review-ui.test.cjs`
- `tests/pipeline.test.cjs`
- `tests/project-document.test.cjs`
- `tests/recovery-ui.test.cjs`
- `tests/redaction-integration.test.cjs`
- `tests/redaction-layers.test.cjs`
- `tests/text-export-contract.test.cjs`
- `tests/text-export-project.test.cjs`
- `tests/text-ui.test.cjs`

## Run evidence

The exact command output logs were retained in the cloud workspace temporary area. Their hashes bind this report to the completed runs:

- `/tmp/legacy-dom-worker-boundary.log`: SHA-256 `61f4b396532a28ecc3f96854a6de7e414e7af9ed8f6fafef3c3b781da0f96669`.
- `/tmp/legacy-refreshed-subset.log`: SHA-256 `f9fe3ff957973e8aa46f1fe75ba4a25facb6998b162d01fb563fe64275fc4be4`.
- `/tmp/legacy-sync-ui-subset.log`: SHA-256 `98c6c1402a35d279e41fee9a661b369d37003a0dcef249a3813d7de196066347`.
- `/tmp/legacy-all-existing.log`: SHA-256 `6b1082b0738208afbde6f7e7ff0c7a17b1dca73f06f5498b0c18e193fd9f74a0`.
