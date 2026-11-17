/* Local model/device selection. This panel never starts inference or downloads. */
(function (root) {
  'use strict';
  const labels = { ready: '可用', missing: '未安装', disabled: '未启用', incompatible: '不兼容', pending: '待审核', blocked: '不可使用', approved: '已审核' };
  function modelLine(model) {
    const devices = (model.devices || []).map(device => typeof device === 'string' ? device : `${device.kind}${device.available ? '' : '（不可用）'}`).join(' / ');
    return `${model.id} · ${model.version}\n${labels[model.status] || model.status || '状态未知'}${model.reason ? '：' + model.reason : ''}\n设备：${devices || '未确认'}\n许可：${model.license?.id || '未知'}（${labels[model.license?.status] || '未审核'}）\n权重 SHA-256：${model.weightsSha256 || '未登记'}`;
  }
  function mount(bridge, document, options = {}) {
    const $ = id => document.getElementById(id);
    if (!$('backendDialog') || !$('backendBtn')) return null;
    let revision = 0, device = 'cpu', report = null;
    const chosen = { parse: null, matting: null }, desired = { parse: null, matting: null };
    const changed = () => options.onChange?.();
    function ready(model) {
      return !!report?.runtime?.available && model.status === 'ready' && model.kind === 'model' && model.license?.status === 'approved' &&
        (report.devices || []).some(item => item.kind === device && item.available) &&
        (model.devices || []).some(item => typeof item === 'string' ? item === device : item.kind === device && item.available);
    }
    function selection(task = 'parse') {
      const model = chosen[task];
      return { device, modelId: model?.id || null, modelVersion: model?.version || null, weightsSha256: model?.weightsSha256 || null, kind: model?.kind || null, ready: !!model && ready(model) };
    }
    function fillModels() {
      for (const task of ['parse', 'matting']) {
        const select = $(task === 'parse' ? 'backendModel' : 'backendMatteModel');
        if (!select) continue;
        const candidates = (report?.models || []).filter(model => model.tasks?.includes(task));
        const usable = candidates.filter(ready);
        const wanted = desired[task];
        chosen[task] = wanted ? usable.find(model => model.id === wanted[0] && model.version === wanted[1]) || null : usable[0] || null;
        if (chosen[task] && !wanted) desired[task] = [chosen[task].id, chosen[task].version];
        select.replaceChildren();
        if (!chosen[task]) {
          const empty = document.createElement('option'); empty.value = ''; empty.textContent = usable.length ? '原选择不可用，请明确选择另一模型' : `当前 ${device.toUpperCase()} 无可用${task === 'parse' ? '人脸解析' : '抠图'}模型`; select.append(empty);
        }
        for (const model of candidates) {
          const option = document.createElement('option'); option.value = JSON.stringify([model.id, model.version]);
          option.textContent = `${model.id} · ${ready(model) ? '可用' : labels[model.status] || '此设备不可用'}`;
          if (model.status === 'ready' && !ready(model)) option.textContent = `${model.id} · 此设备不可用`;
          option.disabled = !ready(model); select.append(option);
        }
        select.disabled = usable.length === 0; if (chosen[task]) select.value = JSON.stringify([chosen[task].id, chosen[task].version]);
      }
      changed();
    }
    async function refresh() {
      const token = ++revision; report = null; chosen.parse = null; chosen.matting = null; changed();
      $('backendRefresh').disabled = true; $('backendSummary').textContent = '正在检查本地运行时与模型文件…';
      try {
        if (typeof bridge?.backendProbe !== 'function') throw new Error('此预览环境没有桌面模型服务。');
        const result = await bridge.backendProbe(); if (token !== revision) return;
        report = result;
        $('backendSummary').textContent = result.runtime?.available ? `Python ${result.runtime.version || ''} · 本机运行时可用。模型是否可运行以所选设备的检查结果为准。` : `运行时不可用：${result.runtime?.reason || '未安装'}。不会自动回退为其他算法。`;
        $('backendDevice').replaceChildren();
        for (const item of result.devices || []) {
          const option = document.createElement('option'); option.value = item.kind;
          option.textContent = `${item.kind.toUpperCase()} · ${item.name || item.kind}${item.available ? '' : '（不可用）'}`;
          option.disabled = !item.available; $('backendDevice').append(option);
        }
        $('backendDevice').value = device; $('backendDevice').disabled = !(result.devices || []).some(item => item.available);
        $('backendModels').replaceChildren();
        for (const model of result.models || []) {
          const card = document.createElement('pre'); card.className = 'backend-model-card'; card.textContent = modelLine(model); $('backendModels').append(card);
        }
        if (!(result.models || []).length) $('backendModels').textContent = '没有注册任何模型。';
        fillModels();
      } catch (error) {
        if (token === revision) { report = null; fillModels(); $('backendSummary').textContent = `检查失败：${error.message || error}。没有运行模型。`; }
      } finally { if (token === revision) $('backendRefresh').disabled = false; }
    }
    $('backendBtn').addEventListener('click', () => { $('backendDialog').showModal(); refresh(); });
    $('backendClose').addEventListener('click', () => $('backendDialog').close());
    $('backendRefresh').addEventListener('click', refresh);
    $('backendDevice').addEventListener('change', () => { device = $('backendDevice').value; fillModels(); });
    for (const task of ['parse', 'matting']) {
      const select = $(task === 'parse' ? 'backendModel' : 'backendMatteModel'); if (!select) continue;
      select.addEventListener('change', () => {
        let identity; try { identity = JSON.parse(select.value); } catch { identity = []; }
        desired[task] = identity.length === 2 ? identity : null;
        chosen[task] = (report?.models || []).find(model => model.id === identity[0] && model.version === identity[1] && model.tasks?.includes(task) && ready(model)) || null;
        changed();
      });
    }
    return Object.freeze({ refresh, getSelection: selection, invalidate: () => { revision++; report = null; chosen.parse = null; chosen.matting = null; changed(); } });
  }
  const api = Object.freeze({ mount, modelLine });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MintBackendPanel = api;
})(typeof window === 'object' ? window : null);
