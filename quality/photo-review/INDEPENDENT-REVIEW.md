# Independent photo-review audit

Status: PASS at the final frozen source checkpoint. No unresolved blocking finding. The direct Node aggregate passed 1,165/1,165 tests with no failures or skips; all audited production/test hashes were unchanged between the start and end of the run.

## Core and project boundary

- Added 27 independently authored tests in `tests/photo-review-independent.test.cjs`, discovered by the repository's existing test wildcard. Tests were invoked directly with Node, not npm.
- Independent history model and BigInt/token-based natural-order reference agree with production behavior. Tests include numeric equivalence with different padding, suffix continuation, 200-digit runs, Unicode and stable import ties.
- No-op review edits retain two full independent history stacks. Returned snapshots are pairwise owned even when all 81 input snapshots alias one frozen object.
- Ordinary getter traps, inherited array-index getter/setter traps, custom prototypes, cycles, hidden fields and forged scalar hooks cannot bypass the core boundary or invoke the tested hooks.
- One hundred photos with the maximum 40 undo plus 40 redo snapshots agree with an independently computed query model across all four sorts, flags and rejected visibility. Hidden selections remain selected, including contradictory reject-only/hide-rejected filters.
- A 100-photo maximum-history project roundtrip preserves all review histories, original SHA-256 identities, source bytes, pixel settings/history, selection and source revision. The input remains unchanged and restored photo reviews do not alias.
- Correctly rehashed legacy v1–v5 files initialize independent neutral reviews without changing source identities or settings. Legacy files containing unexpected review fields fail rather than silently erase them.
- Correctly rehashed v6 files reject absent review, invalid/unselected last-photo data and far-history corruption. Duplicate-key JSON and altered original identity also fail despite valid metadata hashes. The write API alone may initialize omitted review for an older caller.
- Nested review getters reject before any asynchronous hash invocation.

## Integrated handler review

Reviewed the actual `app.js` handlers at the UI owner's stable checkpoint, then rechecked the changes made before the final freeze. The independent UI cases reuse only the existing authored DOM/canvas/IPC harness infrastructure, not its assertions. They are additional behavioral counterexamples against the shipped app, not native-browser or screenshot evidence.

- Review updates, undo and redo use the shared core and remain separate from pixel settings, pixel histories and source identities. Generic `photo.revision` increments are intentional integration behavior, not pixel edits. Exact no-ops do not dirty a saved project.
- View filtering and stable sort never replace the source photo array or silently deselect hidden photos. A hidden current photo remains the current preview. Current-only commands remain current-only when the UI scope selector says selected. Navigation uses visible IDs; no automatic advancement follows a review edit.
- Ratings/flags/labels and complete histories are included in project snapshots and dirty fingerprints; session view filters are not persisted. Import starts neutral, and project restore uses the validated schema6 review state.
- The UI exposes total/visible/global-selected/hidden-selected/rejected-selected counts. Names and badges use text, not HTML. One query result supplies the review-control/card refresh rather than querying the full set for each thumbnail.
- Export, named preset application, synchronization, removal and selected review target the explicit requested set. Hidden/rejected targets are described and require affirmative confirmation; cancellation or unavailable/non-boolean/throwing confirmation does not execute a smaller subset.
- Independent cases verify same-ID object replacement, source-array reordering, review-history-only changes and replaced source Blobs invalidate staged review commits. The snapshot guard binds ordered identities, selections, review histories, revisions, source identity and current view/current photo; settings are checked at the confirmation boundary.
- Awaited preset preflight rejects a history-only review change before committing any candidate pixel settings/history.
- A scope change while an export write is already committing preserves that real successful receipt, stops later persistence and does not pretend to roll back the saved file. Retry reconfirms exactly the remaining rejected photo, writes it once, and does not duplicate the prior success.
- IME composition does not trigger ratings, flags or navigation. Input/modifier/dialog/pointer/manual/matte/crop exclusions are covered by the UI suite. The original selective `activatePhoto` behavior remains latest-wins when two decodes complete out of order, with the real review core enabled.

## Findings resolved during audit

1. A late compatibility fallback initially recognized neutral review through JSON serialization equality. Source inspection showed that extra undefined/symbol fields or a serialization hook could masquerade as neutral. The UI owner replaced it with exact descriptor-based neutral recognition and standard array-prototype checks. Six independent cases now reject extra undefined, symbols, custom object/array prototypes, serialization hooks and snapshot accessors, with zero hook executions. This fallback recognizes only untouched initialization; it is not an alternate review editor or validator.
2. The fit button tooltip still advertised shortcut `0`, now used for unrated review. The UI owner changed the hint to `F`; final HTML was checked.
3. The contract retained candidate-only status and obsolete verification paths. The integration owner corrected the status, production paths, schema6 integration and generic revision explanation.

## Final checks and checkpoint

- Initial independent core/schema suite: 12 passed, 0 failed.
- Initial core + project + native Sharp byte-invariance + independent suites: 56 passed, 0 failed.
- Final `node --test tests/*.test.cjs tests/manual-qa/*.test.cjs`: 1,165 passed, 0 failed, 0 skipped, including all 27 independent cases and 85 new UI cases. The native Sharp export byte-invariance test is included in this aggregate.
- Frozen module hashes matched the assignment: photo-review browser/CommonJS `6de2e3ca00afc3c61560e5acb515e85be9c665e4672195bacd7b5eabbd8e1894`; project codec `90b478af3d078728ea7b0362998358d29a07e4b491cd178e46d66535b7d7adc3`.
- Final app hash: `46eaf241d0d561a4a9dab0e4cd0a968b4c145d750bc1ac26c41601d8793c8b2f`.
- Final HTML hash: `2e7721dfb2b690283e9f06896c1157770ed37d4f44f96daa7c5f18de62e80b73`.
- Final stylesheet hash: `ccb282f361dd72cc0812b8d89150a947005ba3feac7e416d470980ba5560f63d`.

No production code or pre-existing tests were modified by this reviewer. Command/hash evidence is in `independent-evidence.json` beside this report.

## Verification limits

No native Chromium/Electron interaction, native dialog, screenshot, visual-layout/assistive-technology acceptance, Windows or installer run is claimed. Authored DOM/canvas doubles cannot establish those properties. No model inference, dependency installation, browser, network or user-computer access was used. The earlier browser restriction was not retried or bypassed. This is a verified source milestone, not a new installer release.
