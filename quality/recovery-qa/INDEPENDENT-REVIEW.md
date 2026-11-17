# Independent local recovery review

Review date: 2026-10-22 (UTC). Scope: source implementation only, not a released installer.

## Review outcome

Final independent source-level run: **51/51 passed**. Focused retained-feature regressions: **830/830 passed**, including those 51 independent cases. Zero failures, skips or cancellations. No reproduced defect remains open. This report is not a native desktop acceptance claim.

The independent suite is `tests/recovery-independent.test.cjs`. It exercises the real project7 codec and privileged store against synthetic PNG/project data and real temporary filesystem paths. The Electron main/preload and complete shipped app handlers are executed in explicitly authored Electron/DOM/canvas/IPC environments. Infrastructure is shared with earlier UI tests, but the recovery assertions and adversarial scenarios are independent.

## Defects reproduced and repaired during review

1. **Unrecoverable first generation after cleanup failure.** A no-replace hardlink commit succeeded, but temporary unlink failed. The API reported success while refusing its own only draft as a two-link file. The fix allows only the exact same-root fixed-target/UUID-v4-temp pair, proven by identical inode/full stat identity and exactly two links. Independent tests restore through a fresh store, reject a third external link, and reject a UUID-looking different-inode disguise. Reads do not delete either alias.
2. **Private bytes written into a replaced recovery directory.** Replacing the directory at temporary-open time allowed a full private snapshot write before a later identity check rejected it. The fix revalidates root, path and opened descriptor before the first write. The equivalent read-open replacement test confirms zero payload bytes are read from a replacement directory.
3. **False uncommitted report after compound filesystem failure.** Link succeeded and then reported EIO; temporary unlink also failed. Actual committed data was present but the error reported `committed:false`. Exceptional outcome reconciliation now checks the exact committed local pair before cleanup, preserving the correct committed stage and restart readability.
4. **Stale cache capture mislabeled current.** Replacing a valid learned-cache entry during a Blob await while retaining public IDs and byte counts bypassed the old fingerprint. Recovery now binds entry, nested metadata, plane/buffer identities and lengths. It also compares live/cache snapshot bytes once at the final capture boundary. Independent cases cover whole-entry replacement, plane replacement, metadata edits, in-place plane mutation and detachment, alongside same-size source replacement and history edits.
5. **Lost partial-backup evidence in a late cancellation receipt.** A write IPC exception could set the displayed backup stage to false before a pending cancellation response confirmed the backup commit. The controller now reconciles that receipt after awaiting cancellation settlement, preserving the confirmed backup stage while leaving the latest generation explicitly unknown and held. The independent late-receipt reproduction passes.

The initial two failing reproductions are preserved in `initial-defects.tap`; the last cancellation race's pre-fix run is in `late-cancel-defect.tap`. These historical logs intentionally contain failures and are not the final verification result.

## Independently checked contracts

- Defaults off; a disabled manual capture starts no source reads or project serialization.
- Startup generations require an explicit restore/new-cycle decision; neither refresh nor merely opening a different project authorizes overwrite.
- Full original compressed bytes, source revisions, settings, review/history and learned planes freeze before the first Blob await. Binary source/cache lower bounds are checked before large clones; encoded size is checked before final contiguous allocation and IPC.
- Corrupt payload with a valid header remains header-only until full validation. Latest failure exposes only a separately verified previous candidate, without bytes or automatic adoption. Corrupt latest cannot rotate over the last-good previous.
- Strict fixed host paths, sender/main-frame/exact-URL checks and no renderer destination chooser. Losing the single-instance lock does not register handlers, await readiness, or create a window.
- Canceled quit/busy close does not tear down active services. Accepted close blocks later recovery save/configure/open operations.
- 30-second edit debounce, one active job, no queued stale snapshots, no tight retry of a failed stable point, explicit hold for uncertain write outcomes, stale status suppression and late committed-point labeling.
- Cancel/disable settle the active job. Backup and current-generation commit stages are distinct. Main returns structured bounded stage/error information rather than relying on custom Error fields surviving Electron IPC.
- Import/render/export/project/preset/model activity, pointer/manual/matte/crop drafts and uncommitted controls block capture without discarding the live work.
- Restoration stages data before replacement and honors confirmation/cancel. Declined/late/fallback results preserve the current source, unsaved edits and frozen reference. Successful adoption remains unnamed and formally unsaved until a normal project save succeeds.

## Verification evidence

- Independent final run: `independent-tests.tap`, **51/51 passed**. `development-review.tap` is a historical pre-final working log and is not an acceptance result.
- Focused final regressions: `focused-regressions.tap`, **830/830 passed**, covering recovery/project/Levels/manual/reference/pixel-inspector and manual QA suites. This is not the final full repository count; the parent task owns that run.
- Frozen source/test/document hashes are recorded in `SHA256SUMS` and `verification.json`; these bind the report to exact inputs, not a future installer build.

Commands use direct `node --test`. No npm, dependency installation, model execution, network/browser/socket attempts, private photos or user-machine access were used by this review.

## Limits and remaining acceptance

The fake Electron/DOM/canvas/IPC environment does not validate native window lifetime, real IPC transport, visual layout, accessibility/tab order, actual mouse/keyboard behavior, Windows locks/antivirus, application packaging, disk encryption, real-photo memory/performance or physical crash/power-loss recovery. Some retained rendering regressions use already-installed native raster libraries with synthetic data; that is not native app acceptance.

The final check-to-rename interval is not a cross-process compare-and-swap. An arbitrary process with the same OS-user privileges can still race filesystem operations. Observed substitutions fail closed, but this is not a security boundary against a hostile same-user process. Exact directory flush/power-loss durability on Windows remains unconfirmed. Lowering capacity preserves older larger files; crash remnants and temporary writes can exceed the nominal two-generation total. None of these source tests should be represented as a guarantee that all recent edits survive storage loss.
