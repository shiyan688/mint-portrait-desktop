# Portable presets: independent safety review

Date: 2026-10-22 UTC. Review scope: shared codec, host persistence, main/preload boundary, and synthetic full-recipe rendering parity. No production code was changed by this reviewer.

## Result

- Independent suite: **36 passed, 0 failed, 0 skipped**.
- Combined codec, store, independent, and existing main-boundary suites: **85 passed, 0 failed, 0 skipped**.
- Four deliberate unsafe source mutations each caused the intended independent regression to fail. Mutations existed only in temporary in-memory CommonJS compilation hooks; production source was not modified.
- No unresolved blocker was found within the tested scope. This is not a native UI, Windows installation, Android, multi-process locking, or power-loss certification.

Reproduce the independent suite from the repository root:

```sh
node --test tests/preset-independent.test.cjs
```

Reproduce the combined focused checks:

```sh
node --test tests/preset-codec.test.cjs tests/preset-store.test.cjs tests/preset-independent.test.cjs tests/audit-main.test.cjs
```

The combined run completed in approximately 0.77 seconds on this Linux executor. Test names and assertions, rather than test counts alone, define coverage.

## Findings fixed during this review

### 1. Bounded file size was originally enforced after an unbounded read

The original `readSafe` checked `lstat` and `handle.stat`, then used `handle.readFile()`. A same-inode file could grow after the stat, causing an oversized allocation before the final length check rejected it.

The host owner replaced this with an allocation at the validated size, bounded positional reads, a one-byte overrun probe, and a final identity/stat check. The independent regression grows a genuine temporary import file after its first handle stat. It requires rejection and requires total bytes consumed to remain at most the 65,536-byte cap plus one.

Negative control: restoring the old unbounded-read pattern caused the test to fail after reading **131,349 bytes** before enforcing the 65,536-byte cap. The current bounded implementation passes.

### 2. One empty catalog record was accepted as an empty catalog

`MINT-PRESET-CATALOG/1\n\n` originally produced an empty tail after the terminal newline was removed and was treated like the valid header-only empty catalog. That allowed a malformed catalog to be silently replaced on the next save.

The host owner added the distinction between a header-only empty catalog and an empty record. The independent suite now requires list/save/remove/restore to reject the malformed form while leaving both saved copies unchanged.

Negative control: removing the new guard caused this precise fixture to be accepted and the regression to fail. The current implementation passes.

### 3. Recovery omitted a successful commit's durability warning

Normal save, remove, restore, and export propagated `atomic`'s directory-fsync warning, but recovery originally discarded it. The host owner now returns the warning from recovery too. The independent regression injects a directory-fsync failure, verifies the recovery actually committed, and verifies the returned warning on non-Windows systems.

### 4. Final host filename correction preserves Unicode scalar values

The host owner identified and removed an unnecessary 80-UTF-16-unit slice in the suggested export basename. The codec already caps names at 48 Unicode codepoints. With an ASCII character followed by 47 emoji, the former slice split a surrogate pair; an all-emoji name was unnecessarily shortened.

The added independent regression covers both cases and a slash-sanitized 48-codepoint name, requires the complete sanitized name, and checks that UTF-8 encode/decode does not replace any lone surrogate. Restoring the former slice in an in-memory mutation made the test fail specifically with `suggestion contains a lone surrogate`. The corrected host source passes.

## Independent test coverage

### Codec

- The CommonJS source retains the required frozen shared SHA-256, and module/codec APIs remain frozen.
- Duplicate JSON keys are rejected after escape decoding at root, controls, basic, beauty, and advanced-tone levels. Escaped poison keys are rejected.
- Photos, image bytes, paths, IDs, timestamps, landmarks, masks, strokes, geometry, framing, reshape controls, and prototype keys are rejected as extra fields at each relevant structural level. Preset names remain inert display labels, not filesystem authority.
- Accessor properties, symbols, hidden fields, custom prototypes, sparse tone arrays, and `toJSON` hooks are rejected. The getter/hook execution counter stays zero.
- Exact UTF-8 byte boundary, code-unit/string-token/number-token limits, excessive nesting/nodes, cyclic tone input, malformed Unicode, C1 name controls, numeric overflow/underflow, unsupported versions, non-JSON grammar, BOMs, and non-string parser inputs fail closed.
- Disabled advanced-tone recipes survive full roundtrip and color-only conversion. Canonical records have null prototypes; nested results are independently owned; source values remain unchanged. Signed zero normalizes.
- The actual browser-realm UMD source and injected existing tone module produce the same canonical document as CommonJS. This uses Node VM execution, not a browser.

### Store and filesystem

All storage cases use real temporary directories and files. Faults are injected through the supported `fsImpl` boundary while real filesystem operations still occur.

- New/updated catalog persistence, opaque UUIDs, reopen consistency, normalized duplicate-name detection, independent returned copies, and exact previous-catalog backup.
- Invalid/traversal IDs, unknown renderer path fields, and accessor payloads do not change stored data.
- Malformed envelopes, empty records, duplicate IDs, duplicate normalized names, invalid/base64 aliases, malformed documents, missing terminal newline, BOM, and invalid UTF-8 never silently reset or replace an existing catalog.
- Exactly 100 active plus 20 retained entries can be read. Overflow, full trash, full active restoration, and files over 512 KiB reject without purging history.
- Soft deletion, restart-readable retained recipes, successful restoration, and name-conflict restoration leave data recoverable.
- Missing primary with a valid backup fails closed instead of creating an empty catalog.
- Direct root, catalog, backup, import, and export symlinks are refused without altering their targets.
- Canceled native import/export performs no filesystem I/O and clears busy state. The selected host window is passed to the dialog.
- Imports read only the single exact absolute native-dialog path. An extra renderer argument is ignored. Imports are read-only and do not implicitly save or apply a recipe.
- Malformed, empty, oversized, non-UTF8, BOM-bearing, and symlink imports leave existing recipes unchanged. Same-inode growth is rejected within the read budget.
- Exports use the exact native-selected path, sanitize names used only as dialog defaults without splitting Unicode surrogate pairs or truncating valid 48-codepoint names, reject relative paths, reject photo suffixes, and refuse existing contents that are not valid preset documents.
- Partial temporary-write, file-fsync, backup-rename, primary-rename, export-write/rename, exclusive-link, and recovery-commit failures preserve the prior primary/selected-file contents and remove uncommitted temporary files.
- A target created concurrently at new-file commit is not overwritten by the exclusive link. An existing catalog changed between load and commit is not replaced from a stale snapshot.
- The per-store busy gate rejects overlapping list/save/remove/restore/import/export/recovery operations before additional I/O. Canceling the original operation permits subsequent saves.
- Backup-recovery cancellation changes nothing. Confirmed recovery preserves corrupt current bytes under a distinct before-recovery filename; failed recovery commit restores the original primary. Invalid backups do not even prompt for recovery.
- Directory-fsync failures preserve the completed write while reporting a durability warning, including recovery.

### Host boundary and rendering

- Executed actual `main.cjs` with a mocked Electron shell: all seven preset IPC handlers reject the wrong webContents, a different frame, and a navigated main-frame URL before dispatch.
- Executed actual `preload.cjs`: the explicit import/recovery APIs discard renderer path arguments and expose no arbitrary invoke/read/write API.
- The IPC test substitutes only the host preset-service boundary and codec creation across the VM realm. It is a routing/trust test, not an Electron process-isolation or native-dialog test.
- A complete parsed preset with nonzero beauty/basic controls and nontrivial curves/HSL is applied to a synthetic RGBA image using the existing beauty → basic tone → advanced tone sequence. Native export-core and actual pixel-worker VM execution produce byte-identical output, preserve alpha/fully-transparent pixel bytes, and leave the source unchanged.
- The rendering fixture uses only generated pixels and synthetic landmarks. No model inference, new pixel algorithm, private input, external image, or network access is required.

## Mutation controls

Each control ran only its relevant named test, not the source-hash test:

1. Replace bounded reads with `handle.readFile()`: the real-file growth resource assertion fails.
2. Remove the empty-record catalog guard: malformed-catalog preservation test fails.
3. Remove the codec's decoded-key duplicate guard: escaped-alias rejection test fails.
4. Restore the 80-UTF-16-unit suggested-filename slice: the 48-codepoint Unicode regression fails on a lone surrogate.

All four mutation runs returned a failing test result as expected. The unmodified combined run then passed.

## Scope limits and remaining environmental risks

- This review deliberately did not edit or exercise the concurrently changing renderer UI. It does not establish preset-button behavior, photo-selection transaction behavior, undo/redo, batch confirmation, or native visual layout. Those require the UI owner's checks and an integration checkpoint.
- Native Windows dialogs, NTFS-specific behavior, Windows installation/uninstallation, actual browser/Electron interaction, APK operation, and Android parity were not run here.
- The busy gate is per store instance, not interprocess locking. Existing-file commit uses byte revalidation followed by rename, not a cross-process compare-and-swap. A malicious external actor racing after that revalidation, changing ancestor directories, or controlling the host filesystem is outside the guarantee. New-file exclusive linking is separately tested.
- Atomic rename/link tests establish failure handling under injected errors, not crash/power-loss durability. Directory fsync is best-effort and Windows does not run that directory-fsync path. Returned warnings must be surfaced by the UI.
- The codec assumes trusted JavaScript intrinsics and the trusted injected tone validator. Reflection on live arbitrary Proxies is not a sandbox; external data should enter as strictly decoded text. This review checks ordinary accessors and malformed external data, not hostile executable plugin code.

## Reviewed source fingerprints

At the final combined run:

- `src/preset-codec.cjs`: `e69a72b82d6b6c5dc565b39bcb7df21bd0c5842c99735f87eae784c97c7eb84d`
- `preset-store.cjs`: `2aa0003918a3330e6417edc8c474fab57ddbf7277870460de310614698cebf43`
- `main.cjs`: `14d9ab5f5f11b1d4f288cea8d5a9a215ccf2a6383aecbfa4b354782311aa2907`
- `preload.cjs`: `a2a28637eee0558a9988c2a60e4a9d14e44dffc31dcd356224b9f81c27d40d49`
- `tests/preset-independent.test.cjs`: `96a9845014995f9c599ee110afbd1ab27f98d8e6cb00c785d56469b407c2334a`

Reviewer-owned deliverables: `tests/preset-independent.test.cjs` and this review only.
