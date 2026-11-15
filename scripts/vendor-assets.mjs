#!/usr/bin/env node
/**
 * Copies the binary assets the OCR pipeline needs into `vendor/`.
 * They are deliberately NOT committed (see .gitignore) — they are large and are
 * reproduced by `npm install` (postinstall) on every machine and every deploy.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const vendor = path.join(root, 'vendor');

function copy(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return true;
}

const tasks = [];

// Language model (integer "best" build: ~3 MB, noticeably better than "fast")
const engPkg = path.join(root, 'node_modules/@tesseract.js-data/eng');
for (const candidate of ['4.0.0_best_int/eng.traineddata.gz', '4.0.0/eng.traineddata.gz']) {
  const from = path.join(engPkg, candidate);
  if (fs.existsSync(from)) {
    const to = path.join(vendor, 'tessdata', 'eng.traineddata.gz');
    tasks.push([from, to, copy(from, to)]);
    break;
  }
}

// WASM core: ship the LSTM builds (SIMD + non-SIMD) so any browser/CPU works.
const coreDir = path.join(root, 'node_modules/tesseract.js-core');
for (const file of [
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-lstm.wasm',
]) {
  const from = path.join(coreDir, file);
  const to = path.join(vendor, 'tesseract-core', file);
  const ok = copy(from, to);
  if (ok) tasks.push([from, to, ok]);
}

const copied = tasks.filter(([, , ok]) => ok);
for (const [from, to] of copied) {
  const size = (fs.statSync(to).size / 1e6).toFixed(1);
  console.log(`vendor: ${path.relative(root, to)} (${size} MB)`);
}
if (!copied.length) {
  console.warn('vendor: nothing copied — run `npm install` first (dev dependencies are required).');
}
