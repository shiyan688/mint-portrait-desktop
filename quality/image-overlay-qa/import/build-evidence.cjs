'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../../..');
const sharp = require(path.join(ROOT, 'node_modules/sharp')), Project = require(path.join(ROOT, 'src/project-document.cjs'));
const overlayFile = path.join(ROOT,'src/image-overlay.cjs');
const codec = require(path.join(ROOT,'src/image-assets.cjs')).createCodec({ overlay: require(overlayFile) });
const decode = require(path.join(ROOT,'image-import-decode.cjs')).decodeEncodedImage;
const out = __dirname;
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
(async () => {
  fs.mkdirSync(out, { recursive: true }); const width = 1600, height = 900, pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, circle = (x - 800) ** 2 + (y - 450) ** 2 < 330 ** 2;
    pixels[i] = Math.round(x / (width - 1) * 255); pixels[i + 1] = Math.round(y / (height - 1) * 255); pixels[i + 2] = 160;
    pixels[i + 3] = circle ? 192 : (((x >> 6) + (y >> 6)) % 2 ? 64 : 0);
  }
  const source = await sharp(pixels, { raw: { width, height, channels: 4 } }).withMetadata().png().toBuffer();
  const raw = await decode(source, { sharp, inspectImage: Project.inspectImage }), asset = await codec.createAsset(raw.width && { width: raw.width, height: raw.height, data: raw.data }); await codec.verify(asset);
  const reconstructed = codec.toRaw(asset), decodedPng = await sharp(Buffer.from(reconstructed.data), { raw: { width: reconstructed.width, height: reconstructed.height, channels: 4 } }).png().toBuffer();
  fs.writeFileSync(path.join(out, 'synthetic-source-transparent.png'), source); fs.writeFileSync(path.join(out, 'synthetic-decoded-working.png'), decodedPng);
  const report = { generatedAt: new Date().toISOString(), inputs: 'Locally generated RGBA gradient/checkerboard only; no user photos, file picker or Electron execution.', sharpVersion: sharp.versions.sharp,
    frozenMobileSha256: sha256(fs.readFileSync(overlayFile)), source: { width, height, bytes: source.length, sha256: sha256(source), containsMetadata: !!(await sharp(source).metadata()).icc },
    working: { width: raw.width, height: raw.height, rawBytes: raw.data.length, rawSha256: sha256(raw.data), id: asset.id, canonicalBase64Chars: asset.data.length, verified: true, details: raw.details },
    reconstructedPng: { bytes: decodedPng.length, sha256: sha256(decodedPng), containsExif: !!(await sharp(decodedPng).metadata()).exif, containsXmp: !!(await sharp(decodedPng).metadata()).xmp, containsIcc: !!(await sharp(decodedPng).metadata()).icc } };
  fs.writeFileSync(path.join(out, 'synthetic-decode.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
