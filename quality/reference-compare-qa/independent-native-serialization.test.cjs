'use strict';
const test = require('node:test'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), sharp = require('sharp');
const native = require('@napi-rs/canvas'), R = require('../../src/reference-compare.cjs');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
test('investigate native canvas PNG serialization independently of readback', async () => {
  const width = 257, height = 256, original = native.createCanvas(width, height), ctx = original.getContext('2d'), image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) image.data.set([(x * 71 + y * 13) % 256, (x * 19 + y * 83) % 256, (x * 131 + y * 37) % 256, y], (y * width + x) * 4);
  ctx.putImageData(image, 0, 0);
  const meta = { photoId: 'fixture', name: 'fixture.png', sourceRevision: 'fixture:0', mode: 'framed', generation: 1, viewToken: 1, recipeKey: '{}', width, height };
  const pixels = c => c.getContext('2d').getImageData(0, 0, width, height).data;
  async function inspect(c) {
    const buffer = c.toBuffer('image/png'), rgba = await sharp(buffer).ensureAlpha().raw().toBuffer(), live = pixels(c), alpha = [...rgba].filter((_, i) => i % 4 === 3);
    return { width: c.width, height: c.height, pngBytes: buffer.length, pngMetadata: await sharp(buffer).metadata(), pngRgbaHash: hash(rgba), readbackRgbaHash: hash(live), firstPixel: [...rgba.subarray(0, 4)], lastPixel: [...rgba.subarray(-4)], alphaMin: Math.min(...alpha), alphaMax: Math.max(...alpha) };
  }
  const tiny = R.capture(original, meta, () => native.createCanvas(1, 1), () => true);
  const sized = R.capture(original, meta, () => native.createCanvas(width, height), () => true);
  const direct = native.createCanvas(width, height); direct.getContext('2d').drawImage(original, 0, 0);
  const result = { nativeVersion: require('@napi-rs/canvas/package.json').version, original: await inspect(original), copiedTinyFactory: await inspect(tiny.canvas), copiedSizedFactory: await inspect(sized.canvas), directDrawImage: await inspect(direct) };
  ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#53a96d'; ctx.fillRect(0, 0, width, height);
  result.afterSourceRepaint = { original: await inspect(original), tiny: await inspect(tiny.canvas), sized: await inspect(sized.canvas), direct: await inspect(direct) };
  result.matrix = [];
  for (const sourceEarlyEncode of [false, true]) for (const frozenEarlyEncode of [false, true]) {
    const source = native.createCanvas(width, height), context = source.getContext('2d'); context.putImageData(image, 0, 0);
    const accepted = new Uint8ClampedArray(pixels(source));
    if (sourceEarlyEncode) source.toBuffer('image/png');
    const frozen = R.capture(source, meta, () => native.createCanvas(1, 1), () => true);
    const before = hash(pixels(frozen.canvas)); if (frozenEarlyEncode) frozen.canvas.toBuffer('image/png');
    context.clearRect(0, 0, width, height); context.fillStyle = '#53a96d'; context.fillRect(0, 0, width, height);
    const after = hash(pixels(frozen.canvas));
    const exported = await inspect(frozen.canvas), replay = native.createCanvas(width, height); replay.getContext('2d').drawImage(frozen.canvas, 0, 0);
    if (sourceEarlyEncode && !frozenEarlyEncode) fs.writeFileSync(path.join(__dirname, 'independent-native-tobuffer-discrepancy.png'), frozen.canvas.toBuffer('image/png'));
    result.matrix.push({ sourceEarlyEncode, frozenEarlyEncode, accepted: hash(accepted), before, after, exported, replayedAsImage: await inspect(replay) });
  }
  fs.writeFileSync(path.join(__dirname, 'independent-native-serialization.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
});
