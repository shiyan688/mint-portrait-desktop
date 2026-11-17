'use strict';
// Deploy beside main.cjs. Only bounded encoded bytes cross into this worker.
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  try {
    const sharp = require('sharp'); sharp.cache(false); sharp.concurrency(1);
    const Project = require('./src/project-document.cjs');
    const result = await require('./image-import-decode.cjs').decodeEncodedImage(workerData.bytes, { sharp, inspectImage: Project.inspectImage });
    parentPort.postMessage({ ok: true, ...result }, [result.data.buffer]);
  } catch (error) {
    const code = typeof error?.code === 'string' && /^IMAGE_IMPORT_[A-Z_]+$/.test(error.code) ? error.code : 'IMAGE_IMPORT_DECODE';
    parentPort.postMessage({ ok: false, code }); // Never send native errors with local file details.
  }
})();
