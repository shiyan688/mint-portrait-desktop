# Independent desktop per-person QA

Status: **45/45 passed, zero skipped**, development application only. Final source/input SHA256 manifest: [report.json](report.json). No production edits or existing-test edits by this audit.

## Verified

- Real installed NativeCanvas and Sharp decoded/encoded public pixels. Inspected both 2/5-face source composites and before/after contact sheets. Actual previously recorded CPU-model landmark detections are in inputs; no inferred ethnicity or identity matching.
- Two faces receive different beauty/eye/nose controls from the same immutable phase input. Five-face tests edit only local batch IDs 1/3/5. Independent direct-engine delta merges match exact RGBA, reversing batch order stays identical, and source bytes/raw pixels remain unchanged.
- Inactive-face protected rectangles stay exact: 91,553 pixels in the two-face single-active case; 79,261 for five-face alternating selection; 157,913 for five-face single-active case.
- Real native Node-worker PNG export, actual pixel-worker source in authored VM, and independent engine phase merge have identical RGBA SHA256: 3129a261b746183a1e625cd4b8624a753999ff7225475b2a83bb56bb9a8b1110. Beauty precedes basic tone; manual repair/background precede reshape; framing follows reshape. Deliberately wrong phase order differs.
- Schema 13 persists settings/committed/undo/redo/exportedSettings and immutable source, rejects stale batches in every slot, and migrates versions 1–12 to null. Actual slider undo/redo and project replay reproduce byte-identical native PNGs as well as RGBA; project reopen reproduces exact native pixels, even with detector unavailable after reopen.
- Per-face shape changes, new batch IDs and inactive-neighbor landmark changes invalidate final paint/redaction geometry. Beauty-only edits do not. Genuine 478×5 keys fit the bounded 256KiB geometry slot. Selection-mask layers reject shape warps.
- Enable/reset/disable are reversible; no implicit face selection; controls require explicit selection; pure selection creates no history. Pending slider commit, no-face/error/cancel/Escape/late source-photo changes, overlapping support and transparent reshape fail safely. Built-in and portable styles route portrait controls only to selected face; portable exports never include batch IDs, face IDs, source revisions or meshes; sync never transplants them.
- No-effect batch retains 64MP planning baseline; active cap/resource limits are preflighted in native, pixel-worker and modal paths. Working-size choice remains explicit. Manual liquify is disabled before entry with active per-person shape.
- Strict record/accessor/hidden/sparse/provenance checks, intrinsic ArrayBuffer getter checks, resizable backing rejection, cancellation, alpha/hiddenRGB preservation, global-legacy conflicts, overlap and stale geometry negative controls pass.

## Evidence

- [Test log](independent-test.log) and [numeric pixel evidence](pixel-evidence.json)
- [Two-face comparison](public-2-comparison.png) and [five-face comparison](public-5-comparison.png)
- [Native exported public PNG](native-export-public-two.png) and [native/worker parity](native-export-parity.json), plus [native PNG history parity](history-native-png-parity.json)
- [Actual app overlay on NativeCanvas](app-overlay-authored-native.png), explicitly labeled authored shell rather than browser/Windows screenshot
- inputs/ contains the exact public composites, recorded meshes and existing inference provenance. MINT_MULTIFACE_QA_DIR can override the fixture directory. Old in-progress logs are historical findings, not final status.

## Reproduce

Run from repository root:

    node --test tests/portrait-people-workflow-independent.test.cjs > quality/portrait-people-qa/independent-test.log 2>&1
    node quality/portrait-people-qa/render-evidence.cjs
    node quality/portrait-people-qa/write-report.cjs

NativeCanvas must already be installed at the location used by quality/text-qa/native-support.cjs; Sharp is an existing local dependency. No install or network step is performed.

## Boundaries

This is not actual browser, Electron/Windows desktop, installer, new-model, subjective-retouch or ethnicity-specific acceptance. The application shell runs actual app.js but authors DOM/IPC and the preview-pipeline shell; actual worker source and native export are separately verified. Landmarks come from an existing actual CPU-host inference, not a fresh run in this audit. Corrections are existing classical math with learned landmarks, not learned/SOTA retouch. 64MP checks are planning-only, not memory/performance measurement. The shipped 0.2.5 installer remains unchanged by this audit. Public NASA photographs are internal informational QA only, not endorsement, training, marketing or installer assets.
