# Desktop local recovery drafts (opt-in)

This milestone is source-level desktop functionality. It does not claim native-browser layout, real Windows installer/quit acceptance, production-photo performance, model quality, or crash/power-loss durability acceptance. Recovery is not a replacement for a normal `.mintproj` Save As.

## User workflow

Open **本地恢复草稿…** in the local project card. The feature is off until the user enables **我同意在本机保存恢复草稿**. Its preferences are host-owned, not stored in the project document. It sends no photos to an external service, accepts no renderer file paths, does not delete drafts, and never opens private photos automatically.

The dialog displays the application-owned recovery directory, per-generation budget (64 / 128 / 256 / 512 MiB, initially 128), actual two-generation bytes, total scanned directory bytes including preferences and temporary remnants, and each generation's timestamp/size/validation/error. “Header-only” is explicitly not full verification. Unknown/incomplete directory accounting is shown as unknown, never zero. See `RECOVERY-STORE.md` for bounded disk scanning and filesystem defenses.

Only two fixed generations are exposed: latest and previous. A write needs additional temporary-file space. Reducing the budget preserves older larger generations, so they may exceed the new two-generation budget. Disabling recovery leaves existing drafts in place. No deletion UI is supplied.

If either generation exists at startup, automatic overwrite is held, including invalid candidates. Closing the dialog or changing preferences does not release the hold. The user must explicitly:

1. Restore latest or previous successfully; or
2. Choose **开始本次记录，允许后续轮换已有草稿**.

An ordinary project Open is not consent to overwrite startup recovery opportunities. **取消并暂停记录** also holds future capture until an explicit new-cycle choice. Uncertain IPC/commit outcomes hold future automatic capture, even if the document fingerprint later changes.

## Automatic and manual capture

- Once enabled and unheld, a stable committed nonempty session is debounced for 30 seconds. Unchanged committed points do not rotate the files again. Empty sessions do not overwrite recovery files.
- Import, export, model initialization/analysis, rendering, project operations, presets, pointer gestures, crop drafts, manual strokes, matte strokes and uncommitted slider/settings changes prevent capture. Finishing a busy interval requires a new stable debounce. **立即记录 / 重试** uses the same safety and capacity gates.
- One job is in flight at a time. Edits remain available while preparing or writing a draft; no global project lock covers automatic saving.
- Failure of a known capture/write point does not cause a tight automatic retry. Manual retry is available. Unknown write results require an explicit cycle restart after inspection. A confirmed post-commit error is shown as a warning about a point that really was committed, not as a rollback. A canceled/failed latest write that already rotated the previous generation reports that partial backup commit visibly, including when the latest outcome is unknown.
- Draft capture never updates the formal `savedProjectFingerprint` or clears the formal dirty state. Native quit protection therefore still treats an edited recovered/unsaved project as unsaved.

### Snapshot consistency and memory bounds

`projectSnapshot` first checks a source-plus-cache binary lower bound before large snapshot allocations. It then synchronously snapshots the photo order/current ID, immutable Blob references, source identities, settings, committed recipes, review state, undo/redo, metadata and owned copies of typed cache bytes before its first asynchronous Blob read. This fixes the earlier manual-save-only assumption that metadata could safely be cloned after awaiting each source.

Cancellation and the current epoch/fingerprint are checked before and after source reads and codec work. Recovery fingerprints also bind in-memory photo, Blob, cache-entry/result and typed-plane/buffer identities plus nonbinary cache metadata. A single final byte comparison after encoding detects in-place typed-plane mutation or detachment during awaits; ordinary observer/UI updates never scan those binary bytes. Disabled, held and suspended observer/UI paths do not serialize settings or histories at all. Full encoded size is checked before IPC; the production `encodeParts` path checks total size before allocating the final contiguous container. The host independently fully decodes/validates the submitted current project container. Recovery itself adds no schema; the later padding milestone uses project8 and still reads project1–7.

Cancel, disable, ordinary project Open, restore and disposal invalidate pending capture and settle the one in-flight job. A cancellation cannot reverse a completed host rename. The response's confirmed commit is recorded as the actual older stable point even when cancellation/disable/newer edits raced it. A late result never makes the current project formally saved.

## Transactional restore

Restore is explicit for latest or previous. A corrupt latest with a verified previous yields a visible fallback candidate without loading its bytes into the document; **恢复上一代** is a separate explicit operation. The renderer never silently restores the fallback.

All project data, source image dimensions, thumbnails and cards are staged through the existing project loader before replacement. If the current session is dirty, the trusted native replacement confirmation is requested after staging. Repeated clicks are blocked while staging. Cancellation, decode errors, thumbnail errors, missing/declined confirmation and installation failures preserve the original photos, histories, preview, formal saved baseline, frozen reference and original URLs. Only staged URLs are released on failure. Cancellation is checked after every asynchronous restore step, including confirmation.

A successful adoption clears the frozen reference exactly as ordinary project Open does, then remains an unnamed, formally **unsaved** project. This includes an empty restored project. The next normal save selects a formal project destination. Recovery does not attempt to reuse the app-owned draft path as a normal save path. Existing Levels, manual selection/repair recipes, learned-cache bytes, correction histories and photo-review histories remain project data and are round-tripped unchanged.

## Deterministic verification

Run without package-manager operations:

```
node --test tests/recovery-controller.test.cjs tests/recovery-ui.test.cjs
node --test tests/project-ui.test.cjs tests/reference-compare-ui.test.cjs tests/preview-pixel-inspector-ui.test.cjs
```

The controller suite injects deterministic timers and deferred jobs. The UI suite executes shipped `src/app.js` handlers in an authored DOM/canvas/IPC VM with the real project codec, review, Levels, manual and reference modules. Tests cover opt-in, debounce, one in-flight job, empty/unchanged state, busy/live-edit gates, source/cache cloning, changes during Blob reads, capacity refusal, write failures, unknown and post-commit outcomes, disable/late commit, startup protection, fallback choice, cancellation and rollback, reference preservation, and formally-unsaved restoration.

These are not browser, native-dialog, mouse/keyboard, rendering-layout or Windows tests. Outstanding native acceptance should exercise display scaling, keyboard/tab order, large real photos at each budget, disk-full/permissions, actual app close races, two running instance attempts, crash interruption at file-rotation boundaries, and the supported packaged Windows filesystem.
