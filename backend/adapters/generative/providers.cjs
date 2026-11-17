'use strict';
const C = require('./common.cjs');
const OPENAI_MODELS = Object.freeze(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']);
const ALIBABA_MODELS = Object.freeze(['qwen-image-2.0-pro-2026-06-22', 'qwen-image-2.0-pro-2026-04-22', 'qwen-image-2.0-2026-03-03']);
function base(config, descriptor, runner) {
  const enabled = config.enabled === true;
  const getKey = config.getApiKey; // Trusted main-process dependency, never a renderer value.
  const fetchImpl = config.fetchImpl || globalThis.fetch;
  const publicDescriptor = Object.freeze({ ...descriptor, enabled, validation: 'mock-tested-only', liveValidated: false });
  return Object.freeze({
    descriptor: publicDescriptor,
    async run(request) {
      if (!enabled) C.fail('PROVIDER_DISABLED', 'This provider is disabled. Configure it locally before use.');
      if (!request || typeof request !== 'object') C.fail('INVALID_REQUEST', 'An explicit generation request is required.');
      if (typeof getKey !== 'function' || typeof fetchImpl !== 'function') C.fail('PROVIDER_UNCONFIGURED', 'A trusted main-process credential resolver and transport are required.');
      C.abort(request.signal);
      if (!descriptor.models.includes(request.model)) C.fail('UNSUPPORTED_MODEL', 'The exact requested model is not supported; no fallback was used.');
      if (request.task === 'inpaint' && !descriptor.nativeMask) C.fail('UNSUPPORTED_TASK', 'This API adapter does not provide native mask guidance.');
      C.png(request.sourcePng, C.MAX_INPUT_BYTES);
      if (request.maskPng) C.png(request.maskPng, C.MAX_INPUT_BYTES);
      let key;
      try {
        key = await getKey(); C.abort(request.signal);
        if (typeof key !== 'string' || !key || key.length > 8192 || /[\r\n]/.test(key)) C.fail('PROVIDER_UNCONFIGURED', 'No valid locally configured API credential is available.');
        return await runner(request, key, fetchImpl);
      } catch (e) { C.abort(request.signal); throw C.cleanError(e); }
      finally { key = undefined; }
    }
  });
}
function createOpenAIProvider(config = {}) {
  return base(config, {
    id: 'openai', name: 'OpenAI', models: OPENAI_MODELS, nativeMask: true,
    endpoint: 'https://api.openai.com/v1/images/edits',
    pricingUrl: 'https://developers.openai.com/api/docs/pricing',
    documentationUrl: 'https://developers.openai.com/api/docs/guides/image-generation'
  }, async (r, key, fetchImpl) => {
    const form = new FormData();
    form.append('model', r.model); form.append('prompt', r.prompt); form.append('n', '1');
    form.append('size', `${r.outputSize.width}x${r.outputSize.height}`);
    form.append('quality', r.quality); form.append('output_format', 'png');
    form.append('image[]', new Blob([r.sourcePng], { type: 'image/png' }), 'source.png');
    if (r.maskPng) form.append('mask', new Blob([r.maskPng], { type: 'image/png' }), 'mask.png');
    const response = await fetchImpl('https://api.openai.com/v1/images/edits', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
      signal: r.signal, redirect: 'error', credentials: 'omit'
    });
    const body = await C.json(response); C.abort(r.signal);
    if (!Array.isArray(body.data) || body.data.length !== 1 || typeof body.data[0]?.b64_json !== 'string') C.fail('INVALID_OUTPUT', 'Expected one base64 PNG result.');
    const encoded = body.data[0].b64_json;
    if (encoded.length > Math.ceil(C.MAX_OUTPUT_BYTES / 3) * 4 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) C.fail('INVALID_OUTPUT', 'Invalid base64 image result.');
    return { png: C.png(Buffer.from(encoded, 'base64')).bytes, requestId: C.requestId(response.headers?.get('x-request-id')) };
  });
}
function createAlibabaProvider(config = {}) {
  const region = config.region || 'ap-southeast-1', workspaceId = config.workspaceId;
  if (!['ap-southeast-1', 'cn-beijing'].includes(region)) C.fail('INVALID_CONFIG', 'Unsupported Alibaba region.');
  if (workspaceId !== undefined && (typeof workspaceId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(workspaceId))) C.fail('INVALID_CONFIG', 'Invalid Alibaba workspace ID.');
  if (config.enabled === true && !workspaceId) C.fail('INVALID_CONFIG', 'Alibaba requires an explicitly configured workspace and matching regional key.');
  const endpoint = workspaceId ? `https://${workspaceId}.${region}.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` : null;
  return base(config, {
    id: 'alibaba', name: `Alibaba Cloud (${region})`, models: ALIBABA_MODELS, nativeMask: false, endpoint,
    pricingUrl: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    documentationUrl: 'https://www.alibabacloud.com/help/en/model-studio/qwen-image-edit-api'
  }, async (r, key, fetchImpl) => {
    const response = await fetchImpl(endpoint, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: r.model, input: { messages: [{ role: 'user', content: [
        { image: `data:image/png;base64,${Buffer.from(r.sourcePng).toString('base64')}` }, { text: r.prompt }
      ] }] }, parameters: { n: 1, size: `${r.outputSize.width}*${r.outputSize.height}`, prompt_extend: false, watermark: false } }),
      signal: r.signal, redirect: 'error', credentials: 'omit'
    });
    const body = await C.json(response); C.abort(r.signal);
    if (body.code) C.fail('PROVIDER_ERROR', 'Alibaba rejected the generation request; no automatic retry.');
    const choices = body.output?.choices;
    if (!Array.isArray(choices) || choices.length !== 1 || choices[0]?.finish_reason !== 'stop') C.fail('INVALID_OUTPUT', 'Expected one completed Alibaba result.');
    const content = choices[0].message?.content;
    const images = Array.isArray(content) ? content.filter(x => typeof x?.image === 'string') : [];
    if (images.length !== 1) C.fail('INVALID_OUTPUT', 'Expected one Alibaba image URL.');
    let url; try { url = new URL(images[0].image); } catch { C.fail('INVALID_OUTPUT', 'Invalid result URL.'); }
    // Do not permit provider output to become arbitrary-network SSRF, a credential leak or a redirect chain.
    if (url.protocol !== 'https:' || url.port || url.username || url.password ||
        !/^dashscope-result[a-z0-9-]*\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname)) C.fail('UNTRUSTED_OUTPUT_URL', 'Result host is not an approved Alibaba output-storage host.');
    const download = await fetchImpl(url.href, { method: 'GET', signal: r.signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!download.ok) { try { await download.body?.cancel(); } catch {} C.fail('PROVIDER_ERROR', 'Generated-image download failed; the provider may already have billed generation.'); }
    const bytes = await C.readLimited(download, C.MAX_OUTPUT_BYTES); C.abort(r.signal);
    return { png: C.png(bytes).bytes, requestId: C.requestId(body.request_id) };
  });
}
module.exports = { createOpenAIProvider, createAlibabaProvider, OPENAI_MODELS, ALIBABA_MODELS };
