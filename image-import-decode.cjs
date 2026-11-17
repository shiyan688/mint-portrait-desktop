'use strict';
const Guard = require('./image-import-guards.cjs');
async function decodeEncodedImage(value, { sharp, inspectImage }) {
  // Private snapshot before any await: test callers cannot mutate our input.
  const encoded = Guard.fixedEncoded(value, true), header = Guard.inspectEncoded(encoded, inspectImage);
  const bytes = Guard.decoderBytes(encoded), input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = sharp(input, { limitInputPixels: Guard.LIMITS.maxInputPixels, failOn: 'warning', animated: false, pages: 1 });
  const meta = await decoder.metadata();
  Guard.check(['jpeg', 'png', 'webp'].includes(meta.format) && 'image/' + meta.format === header.mime, 'Decoder format mismatch');
  Guard.check((meta.pages || 1) === 1 && !meta.loop && !meta.delay, 'Multi-frame image is unsupported', 'ANIMATED');
  Guard.check(meta.width === header.encodedWidth && meta.height === header.encodedHeight && (meta.orientation || 1) === header.orientation, 'Decoder/header geometry mismatch');
  const plan = Guard.sizePlan(header.width, header.height);
  let image = decoder.autoOrient();
  // Transform tagged sources from their embedded profile. Forcing withIccProfile
  // onto untagged rgb16 changes colors in Sharp 0.35.5; preserve its normal
  // untagged-input interpretation before the explicit sRGB/uchar conversion.
  if (meta.hasProfile) image = image.withIccProfile('srgb', { attach: false });
  image = image.toColourspace('srgb').ensureAlpha();
  if (plan.resized) image = image.resize(plan.width, plan.height, { fit: 'fill', kernel: 'lanczos3', withoutEnlargement: true });
  const decoded = await image.raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  Guard.check(decoded.info.width === plan.width && decoded.info.height === plan.height && decoded.info.channels === 4 &&
    decoded.data.length === plan.width * plan.height * 4, 'Native RGBA result mismatch');
  // Sharp's info.premultiplied reports whether resize USED premultiplication,
  // not the output encoding. Sharp unpremultiplies before raw uchar output.
  // No original bytes, paths, EXIF, XMP or ICC payload leave this function.
  return { width: plan.width, height: plan.height, data: new Uint8Array(decoded.data),
    details: Object.freeze({ encodedWidth: header.encodedWidth, encodedHeight: header.encodedHeight,
      sourceWidth: header.width, sourceHeight: header.height, resized: plan.resized,
      orientationApplied: header.orientation !== 1, color: '8-bit sRGB', alpha: 'straight', metadataPreserved: false }) };
}
module.exports = Object.freeze({ decodeEncodedImage });
