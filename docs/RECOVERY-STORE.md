# Privileged local recovery store

## Scope and privacy

`recovery-store.cjs` is the privileged filesystem component, not an autosave scheduler or renderer session loader. It is off by default. Enabling it must be an explicit user choice in the desktop UI, after showing its actual location and capacity controls.

A recovery generation is the existing strict `.mintproj` container (currently version 7), not a new format. It includes the complete original compressed photos, adjustments, undo/redo history, masks and any other embedded project content supported by that codec. It is not just a small settings file or a preview. It is unencrypted local data, subject to the user's operating-system account, disk encryption and backups. There are no thumbnails, telemetry, network requests, cloud uploads, models or source-photo writes in this store.

Disabling stops future captures and cancels a pending write when possible. It does **not** delete existing drafts. This milestone deliberately provides no delete/purge action and does not silently clean up crash remnants or corrupt files. Recovery is not a replacement for a deliberately saved project or an independent backup.

## Host boundary

Create exactly one store for one fixed, app-owned directory, for example a child of Electron's already-created `userData` directory. The parent directory must already exist; the store does not recursively create arbitrary paths. The host must resolve trusted OS path aliases before supplying `root`, because symlinked roots or ancestors are rejected. Root must be absolute, normalized, local (not a UNC spelling), and not a filesystem root. A location being on a removable or network-mounted filesystem cannot be reliably determined from its spelling; the host must choose genuinely local app storage.

Do not forward a renderer path, destination, filename, validator, filesystem or platform into the constructor. The renderer-facing calls accept only the documented strict payloads. Payload prototypes, proxies, accessor/hidden/symbol/extra fields, unsupported binary subclasses and shared buffers are rejected. Save owns a byte copy synchronously before its first await, and validates the entire container before preparing any generation write.

```js
const { createRecoveryStore } = require('./recovery-store.cjs');
const recovery = createRecoveryStore({
  root: trustedRecoveryDirectory,
  decode: ProjectDocument.decode,
  inspectHeader: ProjectDocument.inspectHeader
});
```

`fs` and `platform` are optional trusted host/test injections. Default decoding and header inspection use `src/project-document.cjs`. This module reuses `project-store.cjs`'s exact-size bounded reader, with extra no-follow/single-hardlink checks. Its atomic writer follows the same temporary-write, fsync and atomic-replace design, additionally supporting small JSON preferences, final cancellation checks, bounded streaming rechecks and verification of the actual temporary bytes.

Fixed files:

- `recovery-latest.mintproj`
- `recovery-previous.mintproj`
- `preferences.json`, containing exactly `{version: 1, enabled, budgetMiB}`

Temporary filenames are generated exclusively by the host in that same directory, with random UUIDs. New files use mode `0600`; a new recovery directory uses `0700` where the OS supports these modes. Regular generation/preference files normally must have exactly one hardlink. The only read exception is a verified local target-plus-own-temporary pair left after no-replace commit cleanup failed: exactly two links, the fixed target name plus its generated UUID-v4 temporary name in the unchanged root, with identical inode/full stat identity. This proof is repeated after restart and does not trust external/original links, malformed names or more than two links. Reads never delete either link. Symlinks, directories, malformed sizes and observed replacements are refused. No user-selected project or original path is involved.

## Capacity and status

`budgetMiB` is a **per newly captured generation** encoded-file cap, selected from `64`, `128`, `256`, or `512`; default `128`. Every project read, including old retained generations, has an unconditional `512 MiB` ceiling. A project valid under the broader general-project limit can still be too large for recovery. It is rejected, not truncated or stripped of history/originals.

Normally two retained generations require at most `2 × selected capacity`, and atomic writes can temporarily require a third generation. These are logical file bytes, not a claim about allocated filesystem blocks or available free space. Preferences add a small amount. Lowering the cap does not delete or truncate older larger files: they remain marked `overBudget`, and rotation may preserve a previously captured larger generation. Consequently retained and transient usage can exceed `2×`/`3×` the **new lower** cap. New capture bytes must obey the new cap. Old crash remnants can also increase usage. Disk-full failure is handled; the store does not claim a free-space reservation or a strict process-memory ceiling equal to the disk cap.

`status()` is read-only and does not create a directory or opt the user in. A missing directory reports its configured path and `realRootPath: null`. When present, status reports:

- `enabled`, `budgetMiB`, `budgetChoicesMiB`, `maxBytes`, `ready`, `busy` and optional `error` and `retainedTemporaryLink` when the exact local two-link exception was verified.
- `rootPath`, and verified `realRootPath` when available.
- `totalBytes`: the two fixed generation files' logical sizes. It can include an oversized/corrupt fixed file without reading its content; it is `null` when not safely measurable.
- `storageBytes`, `storageComplete`, `otherEntryCount`: bounded top-level directory accounting, including preferences and temporary remnants. At most 256 entries are examined. Unknown/unsafe subdirectories, links, errors or an excessive entry count produce an incomplete/unknown total, not a fabricated zero. No payloads are read for this accounting.
- `lastSavedAt`: latest file's filesystem modification timestamp, or previous's when latest is missing. This is a filesystem timestamp, not proof of when the document was authored or of full validation.
- `slots`, in latest/previous order, each with `slot`, `fileName`, `exists`, `available`, `validation`, `sizeBytes`, `modifiedAt`, `overBudget`, optional `error` and `retainedTemporaryLink` when the exact local two-link exception was verified.

Status reads at most 64 project-header bytes per slot, plus bounded preferences and directory metadata. It does not decode/allocate both potentially large generations. `validation: 'header-only'` means only the frame and size have passed, **not** that image/history/blob hashes are valid. `available: true` means a candidate can be offered for a fully validated open. `verified` is cached only against an unchanged full file identity after a full validation in this store instance. Other states are `missing`, `invalid`, and `changed`. A fresh process reports a plausible existing file as `header-only`, not verified.

Corrupt preferences fail closed: status remains disabled with `ready: false` and an error, while still displaying safe root/slot information. Explicit open can still recover a valid existing generation. Configure does not silently repair malformed or unbounded preferences.

## API and UI integration

All operations are promises except `isBusy()` and `cancel()`.

### `configure({enabled, budgetMiB})`

Persists both fields atomically. Returns `{enabled, budgetMiB, committed: true, durabilityWarning}`. No extra keys are accepted. A disable request aborts and waits for a pending save, then persists disabled; other concurrent operations are rejected. Writers cannot jump into that waiting interval. If a final filesystem commit had already happened, disable cannot undo it.

### `save({bytes})`

The only accepted binary input is an ordinary `Uint8Array` or Node `Buffer`. Results:

- Success: `{canceled: false, committed: true, backupCommitted, cancelRequested, sizeBytes, durabilityWarning}`.
- Disabled: `{canceled: false, committed: false, skipped: 'disabled'}`; no draft is written.
- Canceled before current-generation commit: `{canceled: true, committed: false, backupCommitted}`.

Other failures reject with an error and `.code`. Save failures attach `backupCommitted` and `committed`; an unresolvable exceptional commit outcome can additionally carry `commitUncertain`. Do not interpret a failure as permission to discard the user's dirty session, clear a dirty flag, retry indefinitely or declare a formal save. Successful recovery must never mark the session formally saved.

Only one operation is in flight; a second save is rejected with `RECOVERY_BUSY`, not queued with stale bytes. A controller should capture and reschedule its newest dirty state after the current operation, if still enabled, rather than accumulate old snapshots. It must gate initial capture until existing startup recovery candidates have been handled so a fresh empty session does not rotate over unreviewed drafts.

### `open({slot: 'latest' | 'previous'})`

Requires the caller's explicit slot choice. The selected file receives complete container and blob/hash validation before any bytes are returned. Success is `{canceled: false, slot, bytes, displayName, sizeBytes, modifiedAt, fallback}`; `fallback` is true for an explicitly opened previous generation. There is no filesystem write or session mutation.

If latest is missing/corrupt/unsafe and previous can be fully verified, the result is:

```js
{
  canceled: true,
  requiresFallbackChoice: true,
  failedSlot: 'latest',
  error: 'Reason latest could not be opened',
  fallbackCandidate: {
    slot: 'previous', displayName, sizeBytes, modifiedAt, validation: 'verified'
  }
}
```

There are deliberately **no bytes** in that result. The UI must explain the failure, ask whether the user wants the previous generation, and call `open({slot: 'previous'})` only after that choice. No automatic fallback or silent corruption repair is performed. If no verified previous exists, the error is returned normally.

The controller must separately preserve/confirm any current unsaved work before adopting returned bytes, and must use stale-request/session tokens to prevent an asynchronous open from replacing a newer session. Choosing a recovery file is not permission to discard a different unsaved session. The store cannot enforce renderer dirty-state semantics because it never receives or modifies that state. Host-native confirmation can be used by the controller; the store's fallback-candidate API does not require a dialog injection.

### `isBusy()` and `cancel()`

`isBusy()` includes save/open/configure and a disable request waiting for cancellation. `cancel()` requests cancellation of a save only, returning `{requested, committed, backupCommitted}`. That synchronous report is a snapshot, **not** the eventual save outcome or a guarantee that an in-flight rename was stopped. Await the original save promise and inspect its result. Open/configure are not canceled by this method.

The parent must gate close/quit while an operation is busy; if the user chooses cancellation, request it and wait for the operation to settle before quitting. Never interpret `cancel()` as an immediate safe-to-exit signal. A cancel during the final link/rename can be too late: success remains `committed: true, canceled: false, cancelRequested: true`. Durability warnings must be surfaced without falsely claiming rollback.

## Atomicity, failure and concurrent mutation

A save validates the input and both existing generations first. Malformed/unbounded/unsafe existing files are retained and cause fail-closed save failure. In particular, a corrupt latest is **never** copied over a last-good previous, even when the new capture itself is valid. A corrupt previous is not automatically repaired either.

With a valid latest, an independently synced, verified temporary copy atomically replaces previous **before** a separately synced, verified temporary new capture atomically replaces latest. An absent latest leaves an existing valid previous untouched. Cancellation/failure between the two commits can leave both slots holding the older latest, rather than the former previous; at least the prior valid latest remains. This is intentional and preferable to losing the last good draft. Two individually atomic file updates are not a single transactional rename of both slots.

Existing-target replacement uses rename. Absent targets use an atomic no-replace hardlink followed by unlinking the store's own temporary name, so a concurrently created target is not overwritten. No target-unlink/copy fallback exists. The write path hashes actual bytes read back from the temporary file; successful `write()` or `fsync()` alone is not treated as content verification. It rechecks expected target identity and SHA-256 before commit. If a filesystem adapter reports an error after a successful commit, it attempts inode/content reconciliation before describing the operation as uncommitted. Unknown outcomes are not silently retried.

POSIX directory fsync is attempted after commit. Failure is a committed success with a durability warning. On Windows directory-flush durability is explicitly unconfirmed. Filesystem/hardware guarantees, permanent storage loss, power failure, unavailable volumes or full disks cannot be eliminated by this module. Process crashes can leave temporary files; they are counted but are not offered as verified recovery candidates or silently removed. A failed cleanup after a no-replace hardlink can leave a two-link destination. The committed result carries an explicit cleanup warning; reads can recover this file only through the exact local UUID-pair proof described above. A fresh process must reproduce that proof before reading. Arbitrary hardlinks remain refused, and no general hardlink-cleanup or deletion authority is inferred.

The host must take Electron's single-instance lock before creating the store, and must keep one store per root. The local busy guard only serializes this instance's calls. The root and temporary descriptor/path identities are checked again immediately after temporary open and before the first private byte is written. Read opens also recheck root and descriptor/path identity before reading. Identity/hash rechecks detect many external changes, but ordinary filesystem APIs do not provide an atomic cross-process compare-and-swap between the final check and rename. Arbitrary external processes under the same user account can still race, replace directories or alter files; this is not a security sandbox against them. Do not claim that the recheck closes that final race. Changed/lost root identity is rejected and not silently recreated during this process.

## Verification

Run directly, without npm or dependencies:

```sh
node --test tests/recovery-store.test.cjs tests/project-store.test.cjs tests/project-document.test.cjs
```

The recovery tests use only authored synthetic PNGs, strict encoded project bytes and temporary directories. They cover opt-in persistence, precise two-generation rotation, complete originals/history, immutable input capture, strict request grammar, bounded header-only status, corrupt/latest and explicit previous choice, malformed/unbounded preferences and generations, capacity shrink, symlink/hardlink/path/root-loss hazards, disk-full before/after backup, locked rename, lying/corrupt writes, cancellation during validation/write/backup/commit, disable/write and quit races, directory durability warnings, observed external mutation, absent-target no-replace races, crash-remnant accounting and exceptional post-commit reconciliation. These are automated component tests, not a claim of real Windows power-loss testing or interactive desktop QA.
