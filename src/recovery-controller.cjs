/* Opt-in local recovery scheduler. No paths, photos, DOM, or formal-save state. */
(function (root, factory) { 'use strict'; const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.MintRecoveryController = api; })(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MiB = 1024 * 1024, BUDGETS = Object.freeze([64, 128, 256, 512]);
  const aborted = () => Object.assign(new Error('恢复草稿已取消或会话已改变'), { name: 'AbortError' });
  function create({ bridge, readState, capture, onChange = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, delay = 30000, now = () => new Date().toISOString() }) {
    let timer = null, job = null, epoch = 0, request = 0, observed = null, failed = null, committed = null, lastAttempt = null;
    let ready = false, initialized = false, enabled = false, budgetMiB = 128, hold = false, suspended = false, configuring = false, disposed = false, disk = null, error = '', notice = '';
    const view = () => ({ ready, initialized, enabled, budgetMiB, hold, suspended, configuring, disposed, busy: !!job, phase: job?.phase || '', pending: timer !== null, disk, error, notice, lastCommit: committed, lastAttempt });
    const emit = () => { if (!disposed) onChange(view()); };
    const clear = () => { if (timer !== null) clearTimer(timer); timer = null; };
    const state = () => readState();
    const armed = () => !disposed && ready && enabled && !hold && !suspended && !configuring;
    const eligible = s => armed() && !s.empty && s.safe;
    function invalidate() {
      epoch++; clear();
      if (job && !job.controller.signal.aborted) {
        job.controller.abort();
        // Cancellation may race the atomic rename. The save response remains the
        // authority for whether an older point actually committed.
        const active = job; active.cancelPromise = Promise.resolve().then(() => bridge.cancelRecoveryDraft()).then(result => { if (result?.backupCommitted) active.backupCommitted = true; }).catch(e => { error = String(e.message || e); });
      }
    }
    function observe() {
      if (disposed) return;
      // Disabled/held/suspended recovery must not serialize large photo histories
      // on ordinary preview updates. There cannot be a new capture in this state.
      if (!armed()) { clear(); if (job && !job.controller.signal.aborted) invalidate(); emit(); return; }
      const s = state();
      if (s.fingerprint !== observed) { observed = s.fingerprint; failed = null; invalidate(); }
      if (!eligible(s)) { clear(); if (job && !s.safe) invalidate(); emit(); return; }
      if (!job && timer === null && s.fingerprint !== committed?.fingerprint && s.fingerprint !== failed) {
        timer = setTimer(() => { timer = null; void run(false); }, delay);
      }
      emit();
    }
    async function refresh() {
      const id = ++request;
      try {
        const next = await bridge.recoveryStatus();
        if (disposed || id !== request) return view();
        disk = next; ready = next?.ready === true; enabled = ready && next.enabled === true;
        budgetMiB = BUDGETS.includes(next?.budgetMiB) ? next.budgetMiB : 128;
        if (!initialized) { hold = !ready || !!next?.slots?.some(s => s.exists); initialized = true; }
        if (!ready) error = next?.error || '本地恢复状态不可用';
        observe(); return view();
      } catch (e) { if (!disposed && id === request) { ready = false; error = String(e.message || e); emit(); } return view(); }
    }
    async function run(manual) {
      clear();
      if (job || !armed()) { notice = hold ? '请先选择恢复草稿，或明确开始本次恢复记录。' : !enabled ? '本地恢复尚未开启。' : '请等待当前操作结束后再试。'; emit(); return { skipped: true }; }
      const s = state();
      if (!eligible(s)) { notice = s.reason || '请等待当前操作结束并提交调整后再试。'; emit(); return { skipped: true }; }
      if (s.fingerprint === committed?.fingerprint || (!manual && s.fingerprint === failed)) return { skipped: true };
      error = ''; notice = ''; const ownEpoch = epoch, fingerprint = s.fingerprint;
      const active = { controller: new AbortController(), phase: 'capture', promise: null, cancelPromise: null }; job = active;
      const assertCurrent = () => { if (active.controller.signal.aborted || !armed() || epoch !== ownEpoch) throw aborted(); const latest = state(); if (!eligible(latest) || latest.fingerprint !== fingerprint) throw aborted(); };
      // Defer the capture body one microtask so cancel/disable always sees promise.
      active.promise = Promise.resolve().then(async () => {
        try {
          assertCurrent();
          const bytes = await capture({ signal: active.controller.signal, assertCurrent, budgetBytes: budgetMiB * MiB, fingerprint });
          assertCurrent();
          if (!(bytes instanceof Uint8Array) || bytes.byteLength > budgetMiB * MiB) throw new Error('恢复草稿超过每代容量上限；原有草稿未覆盖。');
          active.phase = 'write'; emit();
          const result = await bridge.saveRecoveryDraft({ bytes }); active.outcome = result;
          lastAttempt = { committed: result?.committed ?? null, backupCommitted: result?.backupCommitted === true, commitUncertain: result?.commitUncertain === true };
          if (result?.committed === true) {
            // Truthfully retain the captured point even if cancel/disable/new
            // project happened after the host's commit boundary. Never clean a project.
            committed = { fingerprint, savedAt: now(), sizeBytes: result.sizeBytes ?? bytes.byteLength, stale: epoch !== ownEpoch || state().fingerprint !== fingerprint, warning: result.durabilityWarning || '' };
            notice = committed.stale || result.cancelRequested ? '取消或编辑之前的稳定点已写入；较新更改仍未记录。' : '本地恢复草稿已写入；仍需正式保存项目。';
            if (committed.warning) notice += ` ${committed.warning}`;
            if (result.failed) { error = `稳定点已提交，但后续步骤失败：${result.error || '请检查恢复状态'}。`; failed = fingerprint; }
          } else if (!result?.canceled) {
            error = result?.skipped === 'disabled' ? '恢复已关闭，未写入草稿。' : result?.error || '草稿未确认写入；请检查状态后重试。'; failed = fingerprint;
            if (result?.commitUncertain || result?.committed === null) { hold = true; error = `写入结果不确定：${error}。自动记录已暂停；请检查已有草稿，再明确开始记录。`; }
          }
          if (result?.backupCommitted && result?.committed !== true) {
            const partial = result?.commitUncertain || result?.committed === null ? '上一代备份已确认更新；最新一代的提交结果仍不确定。' : '新草稿未提交；上一代备份已更新，先前最新草稿仍保留。';
            if (error) error += ` ${partial}`; else notice = partial;
          }
          return result;
        } catch (e) {
          const canceled = e?.name === 'AbortError' || e?.code === 'ABORT_ERR';
          const uncertain = active.phase === 'write';
          if (!canceled || uncertain) { error = String(e.message || e); failed = fingerprint; }
          if (uncertain) { hold = true; error = `写入结果不确定：${error}。自动记录已暂停；请检查已有草稿，再明确开始记录。`; }
          if (active.backupCommitted) error += ' 上一代备份已确认更新。';
          lastAttempt = { committed: uncertain ? null : false, backupCommitted: active.backupCommitted === true, commitUncertain: uncertain };
          return active.outcome = { canceled: canceled && !uncertain, committed: uncertain ? null : false, backupCommitted: active.backupCommitted === true, commitUncertain: uncertain, error: error || undefined };
        } finally {
          await active.cancelPromise;
          // A cancel receipt can arrive after a failed save IPC. Preserve that
          // independently confirmed backup stage without inventing a latest commit.
          if (active.backupCommitted && lastAttempt && !lastAttempt.backupCommitted) {
            lastAttempt = { ...lastAttempt, backupCommitted: true };
            if (active.outcome && typeof active.outcome === 'object') active.outcome.backupCommitted = true;
            if (lastAttempt.committed !== true) {
              const partial = '上一代备份已确认更新。';
              if (error) error += ` ${partial}`; else notice = `${notice} ${partial}`.trim();
              if (active.outcome && error) active.outcome.error = error;
            }
          }
          if (job === active) job = null;
          if (!disposed) { await refresh(); observe(); }
        }
      });
      emit(); return active.promise;
    }
    async function cancel({ pause = true } = {}) {
      if (pause) hold = true;
      invalidate(); emit();
      const pending = job?.promise; if (pending) await pending;
      return view();
    }
    async function configure(next) {
      if (configuring || disposed) return { skipped: true };
      if (!next || typeof next.enabled !== 'boolean' || !BUDGETS.includes(next.budgetMiB)) throw new Error('无效的本地恢复设置');
      configuring = true; error = ''; request++; emit();
      try {
        await cancel({ pause: false });
        const result = await bridge.configureRecovery({ enabled: next.enabled, budgetMiB: next.budgetMiB });
        if (result?.committed !== true) throw new Error('恢复设置未确认保存');
        enabled = result.enabled === true; budgetMiB = result.budgetMiB; failed = null;
        notice = enabled ? '本地恢复已开启。' : '本地恢复已关闭；已有草稿仍保留。';
        if (result.durabilityWarning) notice += ` ${result.durabilityWarning}`;
        return result;
      } catch (e) { error = String(e.message || e); return { committed: false, error }; }
      finally { configuring = false; await refresh(); }
    }
    function beginCycle() { if (disposed || !ready) return; hold = false; failed = null; error = ''; notice = '本次恢复记录已开始；后续稳定点会轮换两代草稿。'; observe(); }
    async function suspend() { suspended = true; await cancel({ pause: false }); }
    function resume({ adopted = false, newSession = false } = {}) {
      if (disposed) return;
      suspended = false;
      if (adopted) { hold = false; committed = { fingerprint: state().fingerprint, savedAt: null, recovered: true }; }
      else if (newSession) committed = null;
      observed = state().fingerprint; failed = null; observe();
    }
    async function dispose() { disposed = true; request++; suspended = true; await cancel({ pause: false }); }
    return Object.freeze({ initialize: refresh, refresh, observe, configure, beginCycle, saveNow: () => run(true), cancel, suspend, resume, dispose, getState: view });
  }
  return Object.freeze({ create, BUDGETS, MiB });
});
