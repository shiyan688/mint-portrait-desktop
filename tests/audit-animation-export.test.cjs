'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), sharp = require('sharp');
const { createExportRenderer } = require('../export-renderer.cjs');
const Codec = require('../src/project-document.cjs');
// A valid synthetic 12x8 two-frame red/blue APNG made with Pillow, no private image.
const APNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAwAAAAICAYAAADN5B7xAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAAMAAAACAAAAAAAAAAAAAEACgAAGya3gAAAABdJREFUeJxj/M/A8J+BBMBEiuJRDcQCABXqAg4vSTlQAAAAGmZjVEwAAAABAAAADAAAAAgAAAAAAAAAAAABAAoAAIBVXVQAAAAbZmRBVAAAAAJ4nGNkYPj/n4EEwESK4lENxAIAE+wCDmLcAs4AAAAASUVORK5CYII=', 'base64');

test('actual APNG with decoder-hidden frame count is rejected instead of exported as first frame', async () => {
  const meta = await sharp(APNG).metadata();
  assert.equal(meta.width, 12); assert.equal(meta.height, 8);
  assert.equal(APNG.readUInt32BE(APNG.indexOf('acTL') + 4), 2, 'The fixture really contains two frames');
  const service = createExportRenderer(), before = Buffer.from(APNG);
  try {
    await assert.rejects(service.render({ requestId: 'animated-png', bytes: new Uint8Array(APNG), sourceRevision: 'p:source-0', settings: structuredClone(Codec.DEFAULT_SETTINGS), mode: 'original', format: 'png', quality: .94 }), /动画 PNG\/APNG/);
    assert.equal(service.isBusy(), false);
    assert.deepEqual(APNG, before);
    // A following ordinary PNG still exports, so rejection cannot poison the service.
    const still = new Uint8Array(await sharp(APNG).png().toBuffer());
    const result = await service.render({ requestId: 'still-png', bytes: still, sourceRevision: 'p:source-0', settings: structuredClone(Codec.DEFAULT_SETTINGS), mode: 'original', format: 'png', quality: .94 });
    assert.equal(result.width, 12); assert.equal(result.height, 8);
  } finally { service.dispose(); }
});
