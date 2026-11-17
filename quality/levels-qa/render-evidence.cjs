'use strict';
// Real production Levels algorithm + native export worker evidence. No screenshots,
// model execution, network access, private photographs or new dependencies.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict'), sharp = require('sharp');
const L = require('../../src/levels.cjs'), P = require('../../src/project-document.cjs'), { createExportRenderer } = require('../../export-renderer.cjs');
const { neutral, oracle, delta } = require('./oracle.cjs');
const ROOT = path.resolve(__dirname, '../..'), sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const frozen = '1e454e275c24e2e99b7b6e32bad3569a3ce996e73e2d8cc895c00aea5daf327f';
const fileHash = name => sha(fs.readFileSync(path.join(ROOT, name)));
function moderate() { const r = neutral(); r.strength = .65; Object.assign(r.channels.rgb, { inputBlack: 12, inputWhite: 244, gamma: 1.12, outputBlack: 4, outputWhite: 249 }); r.channels.red.gamma = .98; r.channels.blue.gamma = 1.03; r.channels.blue.outputWhite = 251; return r; }
function extreme() { const r = neutral(); Object.assign(r.channels.rgb, { inputBlack: 90, inputWhite: 160, gamma: .4, outputBlack: 25, outputWhite: 220 }); r.channels.green.gamma = 2; r.channels.blue.outputBlack = 42; return r; }
const variants = [{ name: 'original', label: 'Original pixels', recipe: null }, { name: 'neutral', label: 'Neutral: exact identity', recipe: neutral() }, { name: 'moderate', label: 'User RGB + channel adjustment', recipe: moderate() }, { name: 'extreme', label: 'Endpoint stress: NOT a default', recipe: extreme() }];
function label(text, width, height = 34, size = 15, bg = '#15231f') { return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${bg}"/><text x="10" y="${Math.round(height * .66)}" font-family="sans-serif" font-size="${size}" fill="#f4fff8">${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</text></svg>`); }
function hsv(h, s = .85, v = .88) { const c = v * s, x = c * (1 - Math.abs(h / 60 % 2 - 1)), m = v - c; return (h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]).map(n => Math.round((n + m) * 255)); }
function ramp() { const width = 768, height = 200, data = new Uint8ClampedArray(width * height * 4); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const band = Math.floor(y / 40), n = Math.round(x / (width - 1) * 255), low = Math.round(n / 255 * 31), high = 224 + low; const rgb = band === 0 ? [n, n, n] : band === 1 ? hsv(x / (width - 1) * 359.999) : band === 2 ? [n, 255 - n, 128] : band === 3 ? [low, low, low] : [high, high, high]; data.set([...rgb, 255], (y * width + x) * 4); } return { width, height, data }; }
const imagePng = im => sharp(Buffer.from(im.data), { raw: { width: im.width, height: im.height, channels: 4 } }).png().toBuffer();
async function decode(bytes) { const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) }; }
async function renderSet(name, sourceBytes, source, service) {
  const before = sha(sourceBytes), sourceRgba = sha(source.data), reports = [], panels = [];
  for (const v of variants) {
    const reference = oracle(source, v.recipe), core = L.apply(source, v.recipe); assert.deepEqual(core.data, reference.data);
    const settings = { ...structuredClone(P.DEFAULT_SETTINGS), levels: v.recipe }, result = await service.render({ requestId: `levels-evidence-${name}-${v.name}`, bytes: new Uint8Array(sourceBytes), sourceRevision: `levels-evidence-${name}:0`, settings, analysis: { landmarks: [], sourceRevision: `levels-evidence-${name}:0` }, mode: 'original', format: 'png', quality: .95 });
    const pngBytes = Buffer.from(result.bytes), independentlyDecoded = await decode(pngBytes), expectedExport = new Uint8ClampedArray(reference.data);
    for (let i = 0; i < expectedExport.length; i += 4) if (!expectedExport[i + 3]) expectedExport[i] = expectedExport[i + 1] = expectedExport[i + 2] = 0;
    const parity = delta(independentlyDecoded.data, expectedExport); assert.equal(parity.changedBytes, 0); assert.equal(independentlyDecoded.width, source.width); assert.equal(independentlyDecoded.height, source.height);
    const filename = `${name}-${v.name}.png`; fs.writeFileSync(path.join(__dirname, filename), pngBytes); panels.push({ variant: v, bytes: pngBytes });
    reports.push({ name: v.name, label: v.label, recipe: v.recipe, filename, width: result.width, height: result.height, nativeWorkerPngSha256: sha(pngBytes), readbackRgbaSha256: sha(independentlyDecoded.data), sourceDelta: delta(independentlyDecoded.data, source.data), scalarOracleVsNativeReadback: parity, sourceBytesUnchanged: sha(sourceBytes) === before, sourceRgbaUnchanged: sha(source.data) === sourceRgba });
  }
  return { name, sourcePngSha256: before, sourceRgbaSha256: sourceRgba, panels, reports };
}
async function main() {
  assert.equal(fileHash('src/levels.cjs'), frozen); sharp.cache(false);
  const service = createExportRenderer(); let portrait, synthetic;
  try { const photoBytes = fs.readFileSync(path.join(ROOT, 'quality/fixtures/victor.png')); portrait = await renderSet('victor', photoBytes, await decode(photoBytes), service); const source = ramp(); synthetic = await renderSet('ramp', await imagePng(source), source, service); }
  finally { service.dispose(); }
  const pW = 320, pH = 446, top = 64, labelH = 36, footerH = 56, photoPanels = [];
  photoPanels.push({ input: label('LEVELS ALGORITHM OUTPUT / NATIVE PNG READBACK - NOT AN APP SCREENSHOT', pW * 4, 32, 19), left: 0, top: 0 });
  photoPanels.push({ input: label('Conventional 8-bit sRGB color processing, chosen by user. Not natural-beauty default or learned retouch.', pW * 4, 32, 17), left: 0, top: 32 });
  for (let n = 0; n < portrait.panels.length; n++) { const p = portrait.panels[n]; photoPanels.push({ input: label(p.variant.label, pW, labelH, 15), left: n * pW, top }, { input: await sharp(p.bytes).resize(pW, pH, { fit: 'contain', background: '#101a16' }).png().toBuffer(), left: n * pW, top: top + labelH }); }
  photoPanels.push({ input: label('Public NASA fixture: Victor Glover / NASA-Bill Ingalls. Private factual QA only; no endorsement or product-asset permission.', pW * 4, 28, 15), left: 0, top: top + labelH + pH });
  photoPanels.push({ input: label('Neutral = 0 changed pixels. All native PNG outputs independently decoded and byte-exact to separate scalar reference.', pW * 4, 28, 16), left: 0, top: top + labelH + pH + 28 });
  const portraitContact = 'portrait-levels-contact.png'; await sharp({ create: { width: pW * 4, height: top + labelH + pH + footerH, channels: 4, background: '#101a16' } }).composite(photoPanels).png().toFile(path.join(__dirname, portraitContact));
  const rW = 768, rH = 200, rampPanels = [{ input: label('ALGORITHM OUTPUT: grayscale / hue / opposed RGB / shadows 0-31 / highlights 224-255', rW * 2, 40, 22), left: 0, top: 0 }];
  for (let n = 0; n < synthetic.panels.length; n++) { const p = synthetic.panels[n], left = n % 2 * rW, y = 40 + Math.floor(n / 2) * (rH + 36); rampPanels.push({ input: label(p.variant.label, rW, 36, 18), left, top: y }, { input: p.bytes, left, top: y + 36 }); }
  rampPanels.push({ input: label('Native PNG readback. Neutral identity is exact; extreme clipping is intentional endpoint stress, not recovery or a recommended preset.', rW * 2, 38, 18), left: 0, top: 40 + 2 * (rH + 36) });
  const rampContact = 'synthetic-levels-contact.png'; await sharp({ create: { width: rW * 2, height: 40 + 2 * (rH + 36) + 38, channels: 4, background: '#101a16' } }).composite(rampPanels).png().toFile(path.join(__dirname, rampContact));
  // Decode saved contact-sheet files too: never claim success from encoder buffers alone.
  const contacts = [];
  for (const filename of [portraitContact, rampContact]) { const bytes = fs.readFileSync(path.join(__dirname, filename)), readback = await decode(bytes); contacts.push({ filename, width: readback.width, height: readback.height, pngSha256: sha(bytes), decodedRgbaSha256: sha(readback.data) }); }
  assert.equal(fileHash('src/levels.cjs'), frozen);
  const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'quality/fixtures/manifest.json'), 'utf8')).find(x => x.id === 'victor');
  const report = { date: new Date().toISOString(), algorithm: 'Conventional 8-bit gamma-encoded sRGB Levels; master then channel float mapping; one strength blend; one half-up rounding; alpha retained.', environment: `Node ${process.version}, Sharp ${sharp.versions.sharp}, actual production native export worker threads plus independent Sharp readback; no browser, Windows app, GPU or model run.`, outputsAreNotUIScreenshots: true, notNaturalBeautyDefault: true, sourceHashes: Object.fromEntries(['src/levels.cjs', 'src/pixel-worker.js', 'export-render-core.cjs', 'export-render-worker.cjs', 'src/project-document.cjs', 'src/preset-codec.cjs'].map(n => [n, fileHash(n)])), sourceAttribution: { fixture: 'existing quality/fixtures/victor.png', ...source }, portraits: portrait.reports, synthetic: synthetic.reports, contacts, disclosures: ['This is user-requested conventional color processing, not learned retouch, natural-beauty default, RAW/HDR detail recovery or an aesthetic-quality benchmark.', 'The portrait was already present locally. It is private non-commercial factual software QA, not a product asset or evidence of endorsement.', 'Neutral pixel identity does not mean encoded PNG files are identical: the production exporter embeds its own sRGB profile.', 'Native PNG output intentionally zeroes invisible alpha-zero RGB for privacy. The pure Levels core preserves those hidden source bytes; separate tests verify both contracts.'] };
  fs.writeFileSync(path.join(__dirname, 'visual-evidence.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ core: frozen, portrait: report.portraits.map(x => ({ variant: x.name, changedPixels: x.sourceDelta.changedPixels, oracleReadbackError: x.scalarOracleVsNativeReadback.maxCodeError })), synthetic: report.synthetic.map(x => ({ variant: x.name, changedPixels: x.sourceDelta.changedPixels, oracleReadbackError: x.scalarOracleVsNativeReadback.maxCodeError })), contacts }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
