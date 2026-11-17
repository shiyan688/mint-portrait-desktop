# Desktop named adjustment presets, v2 candidate (reads v1)

## Scope and status

This bounded module adds a local, named library of portable adjustment coefficients next to the existing built-in presets. It is not a project format, image bundle, learned retouching upgrade, geometry preset, model installer, or new pixel algorithm. The existing built-in preset cards and parameter rail are retained.

The renderer changes are in `src/app.js`, `src/index.html`, and `src/styles.css`. The dependency-free shared contract is `src/preset-codec.cjs`; its exact document contract is documented in `PRESET-CODEC-CONTRACT.md`. Host persistence and trusted file dialogs are in `preset-store.cjs`, exposed through the desktop bridge. There is no localStorage, IndexedDB, renderer filesystem authority, or alternate browser persistence fallback.

## Workflow

Open **我的调整预设** under the built-in presets.

1. **读取当前参数** stages the current photo's portable coefficients. Enter a name of 1–48 Unicode code points. This does not change the photo or save a preset.
2. **另存新预设** creates a new catalog entry. **更新选中预设** explicitly replaces the selected entry with the staged controls and current name. Capturing current controls is a separate action, so selecting a saved preset never silently captures unrelated sliders.
3. Selecting an existing preset stages a copy of that preset. Selection is not application. Changing the name edits only the stage.
4. **导入配方** uses the native chooser, validates the entire document, then stages it. It neither saves nor applies. Cancel, invalid data, or a read error preserves the previous stage and all photos. **清除暂存** clears only this temporary stage.
5. **导出选中** exports the selected saved document, not unsaved changes in the stage. No automatic image or project export occurs.
6. Choose **当前照片**, **选中的照片**, or **全部照片**, and choose the application mode. **应用暂存配方** is the only action that applies staged coefficients.

The panel is initially collapsed. Its expanded content scrolls independently; the main canvas and existing parameter rail are not reorganized. Status and progress use an aria-live text area, names use DOM textContent, and no imported name is interpolated into HTML.

## Application semantics

The format has exactly these three control groups:

- Basic tone: exposure, contrast, saturation, temperature.
- Beauty: smooth, brighten, warmth, underEye, redness, lip, blush, palette.
- Advanced tone: the existing validated curve/HSL recipe, or null.

**调色 + 人像修饰** replaces these complete groups, including explicit zeros and a null advanced-tone recipe. An all-neutral preset therefore resets portable controls; it does not reset the rest of the photo.

**仅调色 · 保留原有修肤** replaces basic and advanced tone only. It preserves every target's existing beauty coefficients and palette. It deliberately does not use the codec's portable `colorOnly()` document as a full replacement: doing that would incorrectly erase target beauty.

Both modes preserve each photo's source Blob, dimensions, source revision, framing/crop/rotation/flips, automatic reshape, local layers, local/selection masks, manual selection, liquify/repair commands, legacy spot edits, learned matte corrections, learned cache entries/IDs, parse diagnostics, and background settings. None of these are copied from the preset's source photo. The existing 100-photo, 80 MB per file, and 400 MB session import limits are unchanged.

A changed photo gets exactly one new undo entry for the application, clears redo, advances its revision once, and remains subject to the existing 40-step history bound. Reapplying identical coefficients is a no-op. Each photo can independently undo/redo the operation. Named-preset IDs and names are not added to photo settings, undo records, or project recipe files. Applying coefficients makes an otherwise saved project dirty. Merely reading, naming, saving, importing, removing, restoring, or exporting presets does not make the project dirty.

## Batch preflight and cancellation

Before applying:

- The stage is validated into an owned document, the target set and mode are fixed, and current-photo identity/view token/source plus target identities, immutable Blob references, source revisions, dimensions, edit revisions, selected state, settings, committed settings, and histories are captured.
- An operation lock blocks conflicting imports, project replacement/save, export, ordinary editing, selection mutation, draft commits, new learned jobs, and repeated preset operations.
- Unfinished crop, manual, and matte strokes are canceled, not committed. Stale rendering is invalidated.

For any nonzero beauty coefficient in full mode, the baseline face model must already be ready. Every target's own original Blob is decoded at the existing 1280 preview limit and analyzed through the existing serialized Pipeline.analyze queue. The current photo's mesh is never reused for a different photo. A face count or rectangle is insufficient: the result must contain valid dense 468/478-point MediaPipe meshes with finite supported coordinates and non-degenerate facial bounds.

The entire batch is preflighted before any photo is committed. A missing face, invalid mesh, decoding failure, model failure, stale source/revision/settings/history, or cancellation commits no photo and performs no partial color fallback. Users may explicitly choose color-only and try again; the application never chooses it automatically. Tone-only application needs no decoding or face inference.

Identity/revision checks run across asynchronous boundaries. Deep snapshot comparisons run immediately before the synchronous commit, avoiding repeated serialization of all 100 photos' undo histories on every target. All candidate settings and undo records are allocated before the final check. The commit contains no awaits or UI callbacks between target mutations.

Progress identifies the target and count. **取消本次应用** or Escape invalidates the operation. A MediaPipe call already running may finish before the lock is released, but its late result cannot commit settings or replace current analysis. No new target starts after observed cancellation. Existing current-photo segmentation is preserved when successful face analysis updates only the current photo's landmarks/count.

## Storage, recovery, and limitations

- Desktop catalog limit: 100 active entries and 20 recoverable removed entries. Names that duplicate an active normalized/case-insensitive name are rejected rather than silently renamed or overwritten.
- **移除选中（可恢复）** moves an entry to the removed list. **恢复选中** restores it without applying it. No permanent-delete control or automatic trash eviction is added. Full capacity disables the affected buttons.
- Import/export documents are at most 64 KiB. Export uses `.mintpreset.json` only. The host only permits replacing an existing file that is already a valid preset, not an arbitrary photograph or unrelated file.
- A corrupt/missing primary catalog with a retained backup fails closed. No empty replacement catalog or browser fallback is silently created. The panel exposes **重新读取** and **恢复上次备份…**. Backup recovery is explicitly confirmed by the host dialog and preserves the prior primary file before recovery.
- Host writes use a same-directory temporary file and replace/commit sequence, with bounded validation. This is not a claim of cross-process compare-and-swap or guaranteed power-loss durability. Returned durability warnings for save, export, remove, restore, and backup recovery remain visible rather than being replaced by an unconditional success message.
- An unsuccessful or uncertain write is not automatically retried. The UI requires rereading the catalog before a further catalog write, so a possibly completed operation is not blindly duplicated.
- Without a complete desktop bridge or codec, persistence controls are disabled with an explicit explanation. Existing photo editing remains available.
- The catalog is separate from `.mintproj`. Saving the catalog does not save a photo project; exporting an image does not save the catalog. The user's images and source paths are not automatically embedded in portable preset documents. A user-supplied preset name remains part of the document.

## Pixel behavior

Applied values reuse the existing processing path: portrait beauty, then `MintLocalAdjustments.tone`, then advanced tone, with the already-existing remaining local/manual/background/reshape/framing stages. There is no new tone or beauty implementation in this UI module. Full preset controls apply to the target's own detected face regions. No SOTA, learned precision-retouching, RAW, color-management, or photo-quality claim is made by these coefficient-preservation tests.

## Verification

`node --test tests/preset-ui.test.cjs`: 61 passing focused tests.

Coverage includes:

- Exact neutral resets, null advanced tone, per-photo undo/redo, no-op reapply, redo clearing, and history bounds.
- Strict capture/export whitelisting; independent current/selected/all scopes; preserving target beauty in color-only mode; source, masks, cache, geometry, and manual recipes retained.
- A 100-photo tone-only batch with unchanged source/dimension limits.
- Each target's own analysis input, missing/invalid/sparse/degenerate meshes, inference and decoding failure, and failure of a later target without partial commits.
- Stale current photo, view token, canvas/source Blob/revision, edit revision, settings, history, selection, and removed-photo races.
- Cancellation during analysis, Escape, no late commits or current-fact replacement, no implicit fallback, operation locking, and draft cancellation.
- Import staging/cancel/rejection, safe hostile-name text rendering, explicit new/update/export behavior, duplicate names, soft removal and restoration, catalog corruption, explicit backup recovery, write failure/no retry, caps, and durability warnings.
- Catalog/name/ID omission from actual project encode/decode and coefficients making saved projects dirty.
- Byte-exact replay through the actual beauty/basic/advanced-tone cores using authored pixels and meshes, including undo and redo.

The tests execute the shipped app source with authored DOM, Canvas, IPC, image, and Pipeline doubles and the real codecs/pixel cores. They do not install models, run real face inference, prove native file-dialog behavior, or claim native-browser screen/layout verification. Existing test fixtures were not weakened or edited. The final combined preset, unchanged audit, geometry, project, and advanced-tone UI suites pass 189/189 against the frozen production source. The parent checkpoint's final aggregate test record is authoritative for the complete source tree.

Native Chromium screen capture was attempted with an isolated temporary profile and no disabled browser security flags. This executor rejected Unix-socket creation, so no native screenshot result is claimed. Do not interpret unrelated portrait contact-sheet artifacts as screenshots of this UI.

## Levels increment after checkpoint 10

Portable documents now writev2 with explicit controls.levels. Exact oldv1 documents migrate to neutralnull Levels, so applying an old preset resets the destination's Levels rather than unexpectedly preserving a prior correction. Both full and color-only application replace Levels with an owned validated copy per target. Built-in styles reset Levels alongside advanced curves/HSL; manual/geometry ownership rules remain unchanged. New files require the updated app; old readers rejectv2 instead of dropping Levels. This increment is source-only until a later versioned Setup is built.
