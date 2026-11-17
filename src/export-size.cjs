/* MintExportSize: desktop-only final-output dimensions. No pixel allocation.
 * Call after the existing source, effects, framing, padding and text budgets.
 * Mobile shares the recipe/rounding semantics, NOT these desktop budgets.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (typeof define === 'function' && define.amd) define([], function () { return api; });
  else root.MintExportSize = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LIMITS = Object.freeze({ maxEdge: 16384, maxPixels: 64000000, bytesPerPixel: 4, maxPairBytes: 512000000 });
  const KEYS = Object.freeze(['version', 'mode', 'longEdge']);
  const own = Function.call.bind(Object.prototype.hasOwnProperty);

  function integer(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > LIMITS.maxEdge) {
      throw new RangeError(label + ' must be an integer from 1 to ' + LIMITS.maxEdge);
    }
  }

  function dimensions(width, height, label) {
    integer(width, label + ' width');
    integer(height, label + ' height');
    if (width * height > LIMITS.maxPixels) throw new RangeError(label + ' exceeds the desktop 64,000,000 pixel budget');
  }

  function defaults() { return { version: 1, mode: 'unchanged', longEdge: null }; }

  function validate(value) {
    if (value === null || typeof value !== 'object' ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
      throw new TypeError('Export size recipe must be a plain data record');
    }
    const keys = Reflect.ownKeys(value), r = Object.create(null);
    if (keys.length !== KEYS.length) throw new TypeError('Export size recipe requires only version, mode and longEdge');
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !KEYS.includes(key) || !descriptor || !descriptor.enumerable || !own(descriptor, 'value')) {
        throw new TypeError('Export size recipe fields must be supported own enumerable data properties');
      }
      r[key] = descriptor.value;
    }
    for (const key of KEYS) if (!own(r, key)) throw new TypeError('Export size recipe is missing ' + key);
    if (r.version !== 1) throw new RangeError('Unsupported export size recipe version');
    if (r.mode !== 'unchanged' && r.mode !== 'long-edge') throw new TypeError('Export size mode must be unchanged or long-edge');
    if (r.mode === 'unchanged') {
      if (r.longEdge !== null) throw new TypeError('Unchanged export size requires longEdge: null');
    } else integer(r.longEdge, 'Requested long edge');
    return { version: 1, mode: r.mode, longEdge: r.longEdge };
  }

  function plan(inputWidth, inputHeight, recipe) {
    // Input limits are checked first. Small requested files never excuse an
    // inadmissible composition, source, text canvas or other intermediate.
    dimensions(inputWidth, inputHeight, 'Composition');
    const r = validate(recipe), inputEdge = Math.max(inputWidth, inputHeight);
    if (r.mode === 'long-edge' && r.longEdge > inputEdge) throw new RangeError('Upscaling is not allowed: requested long edge exceeds the composition long edge');
    const resized = r.mode === 'long-edge' && r.longEdge < inputEdge;
    let width = inputWidth, height = inputHeight;
    if (resized) {
      // Integer positive half-up rounding. Exact for all desktop dimensions;
      // equivalent to the mobile semantic, without importing mobile limits.
      const short = Math.max(1, Math.floor((2 * Math.min(inputWidth, inputHeight) * r.longEdge + inputEdge) / (2 * inputEdge)));
      if (inputWidth >= inputHeight) { width = r.longEdge; height = short; }
      else { width = short; height = r.longEdge; }
    }
    dimensions(width, height, 'Output');
    const inputBytes = inputWidth * inputHeight * LIMITS.bytesPerPixel;
    const outputBytes = width * height * LIMITS.bytesPerPixel;
    const extraBytes = resized ? outputBytes : 0;
    return {
      recipe: r,
      input: { width: inputWidth, height: inputHeight },
      output: { width, height },
      resized,
      requestedEdge: r.longEdge,
      scale: resized ? r.longEdge / inputEdge : 1,
      // Accounting for this stage's raw input/output buffers only, not a claim
      // about the whole native pipeline's peak resident memory.
      allocation: { bytesPerPixel: LIMITS.bytesPerPixel, inputBytes, outputBytes, extraBytes,
        peakBytes: inputBytes + extraBytes, pairBytes: inputBytes + outputBytes, maxPairBytes: LIMITS.maxPairBytes }
    };
  }

  return Object.freeze({ LIMITS, defaults, validate, plan });
});
