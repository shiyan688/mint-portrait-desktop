# Desktop photo review candidate

## What is implemented

The production filmstrip now offers manual 0–5 ratings, unmarked/pick/reject flags and none/red/yellow/green/blue/purple labels through the real `MintPhotoReview` core. A collapsed “选片与筛选” panel keeps the canvas central. Each thumbnail has a text rating/flag badge and a color-label stripe; the current photo summary names all three metadata values. File names and metadata are text nodes, not HTML.

Review controls have explicit current-photo and globally-selected-photo scopes. Each changed photo receives one independent review-history step and one generic revision increment. Review undo/redo have their own buttons and do not invoke or alter pixel undo/redo. Exact no-ops preserve history, revision and saved-project cleanliness. The source Blob, immutable source revision, settings, committed settings, masks, manual recipes, framing, learned caches and image pixels remain unchanged. No inference, scoring, auto-culling, dependency acquisition or network operation was added.

The production page loads `photo-review.cjs` before the project codec and app. Import initializes a neutral review record, schema 6 snapshots/fingerprints include the entire review state and histories, and project open restores it. Legacy project migration is handled by the project codec, not by guessing a rating from edited pixels. Invalid existing review metadata is not reset or silently omitted. A missing review script disables the new controls; it does not create an alternate working review engine. Legacy in-memory objects without a review field can be read as neutral for compatibility, while the v6 codec still rejects incomplete serialized records.

## View and navigation

- Inclusive minimum/maximum rating filters, exact flag and color filters, and optional “hide rejected” combine with AND.
- Import, natural file-name, descending-rating and ascending-rating sort orders use the real bounded query core. The source `photos` array remains in import order; thumbnail CSS order changes only presentation.
- Filters and sorting are session-only view state, not project fields. They do not dirty the project or change selections.
- Global selected, hidden-selected and rejected-selected counts stay visible even with the panel closed. Hidden/rejected counts can overlap and are labeled accordingly.
- A filtered-out current photo remains the current preview, with a clear notice. Previous/next and arrow-key navigation use only visible IDs. From a hidden current photo, next enters the first visible item and previous enters the last. Navigation does not wrap or auto-advance after a rating/flag edit.
- “仅选可见（替换选择）” deliberately replaces the global selection and deselects hidden items. “全选全部” still selects every imported photo, including hidden ones.
- No-import and no-filter-results messages are distinct. Filter reset does not remove a photo or a rating.

Unmodified 0–5/P/U/X keys affect only the current photo, regardless of the batch scope selector. Left/right navigate visible photos; F fits the canvas. Review shortcuts ignore inputs (including ranges), selects, textareas, editable text, modifier keys, repeats, IME composition, open app dialogs, operation locks, and active pointers/manual/matte/crop drafts. They do not cancel or accept a brush stroke or crop.

## Safe batch scope

Every export, selected/all preset application, parameter sync, workspace removal and selected-scope review operation computes the exact requested target set. “All” always means all imported photos, never only the filtered filmstrip.

If that set includes hidden or reject-flagged photos, a synchronous native confirmation reports total, hidden and rejected counts and explains that the last two may overlap. Cancellation leaves the operation unapplied. Missing, throwing or non-affirmative confirmation fails closed. Workspace-removal confirmation explicitly says it removes only project references, not disk originals.

Approval freezes the target references/IDs and a session snapshot containing ordered photo identities, selection, review content/history, generic revisions, source identities and current view/current photo. It rechecks immediately after the confirmation, including settings at that boundary. A confirmation-time mutation cancels the complete operation; it never silently selects a smaller fallback set. Review/preset/sync revision overflow is preflighted for all targets before any commit.

Preset application retains its existing atomic settings/history/source checks and additionally binds the scope snapshot throughout asynchronous per-photo preflight. Export retains the existing frozen image recipe rather than switching to live settings; scope, review, selection, revisions and sources are rechecked after folder selection and before rendering/writing. This preserves the existing export-snapshot contract: a raw later settings mutation cannot steer an already-created queue. A changed review/selection/revision cannot silently steer inclusion. If a mutation is detected after prior writes have already committed, those real receipts remain successes and subsequent writes stop/fail; committed files are not misreported as rolled back.

Retries resolve exactly the original pending source IDs and require a fresh hidden/rejected confirmation if appropriate. Removed or replaced pending sources reject the retry instead of disappearing from the queue. Successful files remain excluded from retries. The export dialog shows intended scope counts before start and the queue displays its frozen total and confirmed hidden/rejected counts.

The safety guard does not send paths or file-system authority from the renderer. It uses the existing trusted folder-token export flow and does not change main/preload.

## Verification and limits

`tests/photo-review-ui.test.cjs` executes the shipped app and real review core with authored DOM, canvas, pipeline and IPC doubles. It covers 100-photo edits, one query per UI refresh with 40-step histories, filters/sort/selection/navigation, independent history/no-ops, project v6 save/open, keyboard exclusions, malformed data, scope confirmation/cancellation, confirmation-time and awaited-work races, retry identity and revision overflow. Existing audit/preset tests are unchanged. The VM harness explicitly preserves same-realm review records when adapting Node's host `structuredClone`; this is not a production fallback.

No real Chromium/Electron/Windows interaction, visual layout screenshot, native-dialog behavior, assistive-technology audit or model inference is claimed by these tests. Earlier browser/Chromium environment restrictions were not retried or bypassed. The added CSS and markup have authored-DOM and static checks, not a claimed real-screen acceptance. This module is included in the 0.2.2 development bundle; its separate static installer validation does not establish native UI or professional editing/AI quality.

Exact executed test counts and local evidence logs are reported with the checkpoint rather than hard-coded here, because independent tests may be added concurrently.
