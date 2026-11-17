'use strict';
// Independent scalar reference: no production Levels import or LUT lookup.
const keys = ['rgb', 'red', 'green', 'blue'];
function channel() { return { inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 }; }
function neutral() { return { version: 1, strength: 1, channels: Object.fromEntries(keys.map(k => [k, channel()])) }; }
function recipe() {
  const r = neutral(); r.strength = .73;
  r.channels.rgb = { inputBlack: 19, inputWhite: 237, gamma: 1.31, outputBlack: 7, outputWhite: 244 };
  r.channels.red = { inputBlack: 13, inputWhite: 246, gamma: .82, outputBlack: 4, outputWhite: 251 };
  r.channels.green.gamma = 1.11; r.channels.blue.outputWhite = 226;
  return r;
}
function transfer(value, c) {
  if (c.inputBlack === 0 && c.inputWhite === 255 && c.gamma === 1 && c.outputBlack === 0 && c.outputWhite === 255) return value;
  if (value <= c.inputBlack) return c.outputBlack;
  if (value >= c.inputWhite) return c.outputWhite;
  return c.outputBlack + ((value - c.inputBlack) / (c.inputWhite - c.inputBlack)) ** (1 / c.gamma) * (c.outputWhite - c.outputBlack);
}
function scalar(value, key, r) {
  if (!r || !r.strength) return value;
  const master = transfer(value, r.channels.rgb), individual = transfer(master, r.channels[key]);
  return Math.floor(value + (individual - value) * r.strength + .5);
}
function oracle(image, r) {
  const data = new Uint8ClampedArray(image.data);
  for (let p = 0; p < data.length; p += 4) if (data[p + 3] !== 0) for (let k = 0; k < 3; k++) data[p + k] = scalar(image.data[p + k], keys[k + 1], r);
  return { width: image.width, height: image.height, data };
}
function picture(width = 129, height = 97, alpha = false) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([(x * 13 + y * 3) % 256, (y * 19 + x * 7) % 256, (x * 23 + y * 11 + 31) % 256, alpha ? [0, 1, 17, 127, 254, 255][(y * width + x) % 6] : 255], (y * width + x) * 4);
  return { width, height, data };
}
function delta(a, b) { let changedPixels = 0, changedBytes = 0, alphaChanged = 0, maxCodeError = 0; for (let p = 0; p < a.length; p += 4) { let changed = false; for (let k = 0; k < 4; k++) { const d = Math.abs(a[p + k] - b[p + k]); maxCodeError = Math.max(maxCodeError, d); if (d) { changedBytes++; if (k === 3) alphaChanged++; else changed = true; } } if (changed) changedPixels++; } return { changedPixels, changedBytes, alphaChanged, maxCodeError }; }
module.exports = { keys, channel, neutral, recipe, transfer, scalar, oracle, picture, delta };
