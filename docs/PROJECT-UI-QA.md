# Project UI integration QA

## Implemented behavior

- The desktop left-side project card has distinct **Open project** / **Save project** actions. Menu actions and Ctrl/Cmd+S / Ctrl/Cmd+Shift+O use the same guarded paths. Ctrl/Cmd+O continues to import photographs.
- `.mintproj` is a non-destructive project, not an exported photograph. Original compressed image bytes are embedded unchanged, alongside settings, committed settings, per-photo undo/redo history, selection, current photo, presets, immutable validated learned caches, matte corrections and the last selected matte identifiers. Optional exported-settings metadata is adapted from the renderer's historical JSON string to codec settings data.
- Saves cancel unfinished brush drafts, commit pending current-photo slider history, and require imports, exports, image loads, active analysis/rendering and learned jobs to settle. Project operations lock editing. The clean baseline is the fingerprint of the state actually snapshotted, not the state that happens to exist when asynchronous writing completes. Cancellation or errors never clear the dirty warning.
- Exported image copies do not mark an unsaved project clean. After a project save, changing settings/history, importing/removing photographs, changing selection/current photograph or adding cache results marks the project dirty again. Empty projects can be saved after all photographs are removed.
- Opening uses the real bounded project codec before image decoding, decodes every source, compares actual decoded original dimensions with project metadata, prepares every thumbnail, and prepares the active 1280px preview before replacing anything. An unsaved workspace additionally requires the trusted main-process replacement confirmation. No filesystem path is chosen by the renderer.
- Cancellation, malformed project data, decoding/dimension/thumbnail failures, missing/declined confirmation and a synchronous DOM-installation failure retain the existing workspace. Staged thumbnail URLs are revoked on failure. Previous URLs remain live until successful installation, then are revoked.
- Verified cached learned alpha and brush corrections remain available when local models are missing. Reopening does not run a new learned task. Existing no-fallback semantics are preserved.
- Larger original files can be preserved in a project; this does **not** remove preview/export/learned-inference size limits. The UI continues to explain capped export and the difference between source preservation and full-resolution processing.

## Executed checks

`node --test tests/project-ui.test.cjs tests/learned-ui.test.cjs tests/audit-ui.test.cjs`

94 tests passed: 28 new project UI tests, 54 existing learned UI tests unchanged, and 12 existing renderer audit tests. The one obsolete audit assertion that a successful image export clears the native dirty flag was updated, with authorization, to require that unsaved project state remains dirty.

The new tests execute the actual shipped app functions with authored DOM/canvas/IPC doubles and the real project codec. They cover:

1. Original compressed-byte fidelity and settings/history/selection/export-metadata roundtrip.
2. Save success, cancel, write failure, unfinished brush cancellation, operation locking and late-edit dirty-state protection.
3. Project-entry blocking during import, export, photo load, analysis, rendering and learned jobs.
4. Complete multi-photo preparation before confirmation/replacement, including active photo and selected state.
5. Corrupt files, chooser cancellation, decode failure, source-dimension mismatch, thumbnail failure, declined/missing confirmation and late-photo failure, with staged URL cleanup.
6. Rollback of source preview, photos, history and saved baseline after an authored DOM error during installation.
7. Dirty transitions for image export versus project save, current/selected photo changes, import, removal and an empty saved workspace.
8. Keyboard/menu wiring and accurate source-preservation/export-limit copy.
9. Restored learned alpha, original-coordinate corrections, undo/redo and resave with models unavailable.
10. A 5000px-wide original embedded unchanged while the UI still announces the capped export dimensions.

## Explicit limitations

These checks do not validate actual native file dialogs, GPU/model inference, browser image decoding, visual layout, filesystem durability, signed installers or Windows runtime behavior. Canvas/DOM/IPC are deterministic test doubles. No model or API execution was performed. Browser-based QA remains blocked by the reported unavailable browser transport; no browser or native Windows success is claimed.

Main-process store and codec tests provide separate coverage of file-format validation, trusted dialogs, byte bounds, atomic writes and path restrictions. Installer tests require the separately generated installer payload; their absence from a source-only working directory is not a renderer/project UI pass.
