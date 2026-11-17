'use strict';
const { randomUUID } = require('node:crypto');
const C = require('./common.cjs');
const providersModule = require('./providers.cjs');

/** Trusted main-process module. Importing this file performs no network or credential access. */
function createGenerativeSession(options) {
  if (!options || typeof options !== 'object') C.fail('INVALID_CONFIG', 'Session options are required.');
  let original = C.image(options.image);
  const revision = C.string(options.photoRevision, 'photo revision', 200);
  const codec = options.codec;
  if (!codec || typeof codec.encodePNG !== 'function' || typeof codec.decodePNG !== 'function') C.fail('INVALID_CONFIG', 'A validated PNG codec is required.');
  // This callback must be supplied by trusted application code, NOT by the renderer.
  const confirmUpload = options.confirmUpload;
  const now = options.now || Date.now;
  const timeoutMs = options.timeoutMs ?? 180000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) C.fail('INVALID_CONFIG', 'Invalid request timeout.');
  const registry = new Map();
  for (const provider of options.providers || []) {
    if (!provider?.descriptor || typeof provider.run !== 'function' || registry.has(provider.descriptor.id)) C.fail('INVALID_CONFIG', 'Invalid or duplicate provider.');
    registry.set(provider.descriptor.id, provider);
  }
  let epoch = 0, closed = false, prepared = null, candidate = null, active = null, preparation = 0;
  let transportTail = Promise.resolve();
  const open = () => { if (closed) C.fail('SESSION_CLOSED', 'Photo session is closed or its revision has changed.'); };
  const current = (jobEpoch, job) => !closed && epoch === jobEpoch && active === job && !job.settled;

  async function prepare(request) {
    open();
    if (!request || !['instruction-edit', 'inpaint'].includes(request.task)) C.fail('UNSUPPORTED_TASK', 'Only same-canvas instruction editing and inpainting are implemented.');
    const provider = registry.get(request.providerId), d = provider?.descriptor;
    if (!d) C.fail('PROVIDER_MISSING', 'The selected provider is not registered.');
    if (d.enabled !== true) C.fail('PROVIDER_DISABLED', 'This provider is disabled.');
    if (!d.models.includes(request.model)) C.fail('UNSUPPORTED_MODEL', 'The exact selected model is unavailable; no fallback.');
    if (request.task === 'inpaint' && !d.nativeMask) C.fail('UNSUPPORTED_TASK', 'This provider does not expose native mask guidance.');
    const prompt = C.string(request.prompt, 'editing instruction', 4000);
    // Conservative application guard; do not let the provider silently truncate long instructions.
    if (d.id === 'alibaba' && Buffer.byteLength(prompt, 'utf8') > 1200) C.fail('INVALID_REQUEST', 'Alibaba instructions are limited here to 1200 UTF-8 bytes; shorten the instruction.');
    const m = C.mask(request.mask, original);
    const strength = request.strength;
    if (!Number.isFinite(strength) || strength < 0 || strength > 1) C.fail('INVALID_REQUEST', 'Strength must be in [0, 1].');
    if (strength === 0 || !m.data.some(v => v > 0)) C.fail('NO_EDIT', 'No edited pixels: no API call is necessary.');
    const geometryPolicy = request.geometryPolicy ?? 'require-source-size';
    if (!['require-source-size', 'resize-to-source'].includes(geometryPolicy)) C.fail('INVALID_REQUEST', 'An explicit output geometry policy is required.');
    if (geometryPolicy === 'resize-to-source' && typeof codec.resizeRGBA !== 'function') C.fail('INVALID_CONFIG', 'Explicit resizing needs a validated resampling codec.');
    const outputSize = Object.freeze({ width: request.outputSize?.width ?? original.width, height: request.outputSize?.height ?? original.height });
    const { width, height } = outputSize, area = width * height;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 16 || height < 16 || width % 16 || height % 16) C.fail('INVALID_REQUEST', 'Provider output dimensions must be positive multiples of 16.');
    if (d.id === 'openai' && (area < 655360 || area > 8294400 || Math.max(width,height) > 3840 || Math.max(width,height)/Math.min(width,height) > 3)) C.fail('INVALID_REQUEST', 'Requested size violates OpenAI image-size limits.');
    if (d.id === 'alibaba' && (area < 262144 || area > 4194304)) C.fail('INVALID_REQUEST', 'Requested size violates Alibaba image-size limits.');
    if (geometryPolicy === 'require-source-size' && (width !== original.width || height !== original.height)) C.fail('GEOMETRY_MISMATCH', 'Changing output size requires explicit resize-to-source consent.');
    const quality = request.quality ?? 'high';
    if (!['low','medium','high','xhigh','max'].includes(quality)) C.fail('INVALID_REQUEST', 'Choose an explicit quality setting.');
    if (d.id === 'alibaba' && quality !== 'high') C.fail('INVALID_REQUEST', 'This Alibaba endpoint has no quality selector; use high (provider-defined quality).');
    const token = ++preparation, prepareEpoch = epoch;
    // Encode copies, never the private immutable original. No EXIF/file path is supplied.
    let sourcePng, maskPng = null;
    try {
      const encoded = C.png(await codec.encodePNG(C.image(original)), C.MAX_INPUT_BYTES);
      if (encoded.width !== original.width || encoded.height !== original.height) C.fail('CODEC_ERROR', 'The PNG encoder changed source dimensions.');
      sourcePng = encoded.bytes;
      if (d.nativeMask) {
        const maskImage = C.image(original);
        for (let p = 0; p < m.data.length; p++) {
          maskImage.data[p*4] = maskImage.data[p*4+1] = maskImage.data[p*4+2] = 255;
          // Generate over all selected pixels; only the local compositor applies the soft weight.
          maskImage.data[p*4+3] = m.data[p] > 0 ? 0 : 255;
        }
        const encodedMask = C.png(await codec.encodePNG(maskImage), C.MAX_INPUT_BYTES);
        if (encodedMask.width !== original.width || encodedMask.height !== original.height) C.fail('CODEC_ERROR', 'The PNG encoder changed mask dimensions.');
        maskPng = encodedMask.bytes;
      }
    } catch (e) { throw C.cleanError(e); }
    open();
    if (prepareEpoch !== epoch || token !== preparation) C.fail('STALE_PREPARATION', 'A newer preparation replaced this request.');
    const id = randomUUID(), expiresAt = now() + 300000;
    const sourceSha256 = C.sha(sourcePng), maskSha256 = C.sha(Buffer.from(m.data.buffer));
    const digest = C.sha(JSON.stringify({ revision, providerId: d.id, endpoint: d.endpoint, model: request.model, prompt, sourceSha256, maskSha256, strength, geometryPolicy, outputSize, quality }));
    const summary = Object.freeze({
      preparedId: id, requestDigest: digest, photoRevision: revision, expiresAt,
      providerId: d.id, providerName: d.name, endpoint: d.endpoint, model: request.model,
      task: request.task, prompt, sourceSize: Object.freeze({ width: original.width, height: original.height }),
      outputSize, sourceSha256, maskSha256, uploadBytes: sourcePng.length + (maskPng?.length || 0),
      quality, strength, geometryPolicy, nativeMask: d.nativeMask,
      disclosure: 'Uploads this photo and instruction to the selected provider for one paid image. Cancellation may not stop billing. No retry or fallback. Output is a candidate, not an automatic replacement.',
      cost: Object.freeze({ type: 'metered', estimate: null, hardCapEnforced: false, pricingUrl: d.pricingUrl,
        disclosure: 'The provider meters this job; this adapter cannot enforce a per-job monetary cap. Review current pricing and your account spending controls before confirming.' })
    });
    prepared = { id, summary, provider, prompt, model: request.model, task: request.task, sourcePng, maskPng, mask: m, strength, geometryPolicy, outputSize, quality };
    return summary;
  }

  function start(preparedId) {
    open();
    if (typeof confirmUpload !== 'function') C.fail('CONFIRMATION_UNAVAILABLE', 'A trusted main-process per-job confirmation dialog is required.');
    const p = prepared;
    if (!p || p.id !== preparedId) C.fail('STALE_PREPARATION', 'Prepare this exact photo and request again.');
    if (now() > p.summary.expiresAt) { prepared = null; C.fail('CONSENT_EXPIRED', 'The prepared request expired.'); }
    prepared = null; // A prepared confirmation cannot be replayed.
    const jobEpoch = epoch, controller = new AbortController(), id = randomUUID();
    let resolve, reject, state = 'queued', timer = null;
    const result = new Promise((yes,no) => { resolve=yes; reject=no; });
    const record = { id, settled: false, cancel };
    function settle(next, value, error) {
      if (record.settled) return false;
      record.settled = true; state = next; clearTimeout(timer);
      if (active === record) active = null;
      if (error) reject(error); else resolve(value);
      return true;
    }
    function cancel(reason = 'CANCELLED') {
      const changed = settle(reason === 'STALE_JOB' ? 'superseded' : 'cancelled', null,
        new C.GenerativeError(reason, reason === 'TIMEOUT' ? 'Request timed out; provider billing may already have started.' : 'Job cancelled or replaced; no late result will be accepted.'));
      if (changed) controller.abort();
      return changed;
    }
    const job = Object.freeze({ id, get state() { return state; }, result, cancel: () => cancel() });
    const previous = active; active = record; candidate = null;
    if (previous) previous.cancel('STALE_JOB');
    // Serialize actual work. Cancelling a fetch does not justify starting another physical
    // request until its promise settles; this also bounds providers ignoring abort.
    const execute = async () => {
      if (!current(jobEpoch, record)) return;
      try {
        state = 'awaiting-confirmation';
        const approval = await confirmUpload(p.summary, controller.signal);
        if (!current(jobEpoch, record)) return;
        if (approval?.approved !== true || approval.preparedId !== p.id || approval.requestDigest !== p.summary.requestDigest) C.fail('CONSENT_REQUIRED', 'This exact upload and metered cost were not confirmed.');
        if (now() > p.summary.expiresAt) C.fail('CONSENT_EXPIRED', 'Confirmation expired before sending.');
        state = 'running'; timer = setTimeout(() => cancel('TIMEOUT'), timeoutMs);
        const response = await p.provider.run({ task: p.task, model: p.model, prompt: p.prompt,
          sourcePng: Buffer.from(p.sourcePng), maskPng: p.maskPng ? Buffer.from(p.maskPng) : null,
          quality: p.quality, outputSize: p.outputSize, signal: controller.signal });
        if (!current(jobEpoch, record)) return;
        const png = C.png(response?.png);
        let prediction = C.image(await codec.decodePNG(png.bytes));
        if (!current(jobEpoch, record)) return;
        if (prediction.width !== png.width || prediction.height !== png.height) C.fail('CODEC_ERROR', 'Decoded dimensions do not match the PNG header.');
        const generatedSize = Object.freeze({ width: prediction.width, height: prediction.height });
        let transform = 'none';
        if (prediction.width !== original.width || prediction.height !== original.height) {
          if (p.geometryPolicy !== 'resize-to-source') C.fail('GEOMETRY_MISMATCH', 'Provider changed dimensions; candidate rejected without resampling.');
          prediction = C.image(await codec.resizeRGBA(prediction, original.width, original.height));
          if (!current(jobEpoch, record)) return;
          if (prediction.width !== original.width || prediction.height !== original.height) C.fail('CODEC_ERROR', 'Explicit resampling did not restore original dimensions.');
          transform = 'explicit-resize-to-source';
        }
        const output = C.image(original);
        for (let i=0; i<p.mask.data.length; i++) {
          const w = p.mask.data[i] * p.strength;
          if (!w) continue;
          for (let c=0; c<3; c++) output.data[i*4+c] = Math.round(original.data[i*4+c] + w*(prediction.data[i*4+c]-original.data[i*4+c]));
          // Original alpha, including hidden RGB at zero edit weight, is preserved exactly.
        }
        const provenance = Object.freeze({ kind: 'api', providerId: p.summary.providerId, model: p.model,
          providerRequestId: C.requestId(response.requestId), jobId: id, photoRevision: revision,
          requestDigest: p.summary.requestDigest, sourceSha256: p.summary.sourceSha256,
          maskSha256: p.summary.maskSha256, generatedSize, transform,
          nativeMask: p.summary.nativeMask, validation: 'live-result-not-quality-validated' });
        const candidateId = randomUUID();
        candidate = { id: candidateId, epoch: jobEpoch, output, provenance };
        settle('succeeded', Object.freeze({ candidateId, image: C.image(output), provenance }));
      } catch (e) { if (!record.settled) settle('failed', null, C.cleanError(e)); }
    };
    transportTail = transportTail.then(execute, execute);
    return job;
  }
  function take(candidateId, accepted) {
    open();
    if (!candidate || candidate.id !== candidateId || candidate.epoch !== epoch) C.fail('STALE_CANDIDATE', 'This candidate is no longer current.');
    const value = candidate; candidate = null;
    return accepted ? Object.freeze({ image: C.image(value.output), provenance: value.provenance }) : true;
  }
  function invalidate() {
    if (closed) return; closed=true; epoch++; preparation++; prepared=null; candidate=null;
    const prior=active; active=null; if (prior) prior.cancel('STALE_JOB'); original=null;
  }
  return Object.freeze({
    prepare, start,
    listProviders() { return Object.freeze([...registry.values()].map(p => p.descriptor)); },
    getOriginal() { open(); return C.image(original); },
    accept: id => take(id, true), reject: id => take(id, false),
    // Call on source edit/undo/redo/photo change, not only navigation/close.
    invalidate, dispose: invalidate
  });
}
module.exports = Object.freeze({ createGenerativeSession, GenerativeError: C.GenerativeError, ...providersModule });
