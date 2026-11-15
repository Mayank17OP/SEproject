import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Line, Page, Word } from './types';
import { buildLines } from './text';
import { tessCorePath, tessdataPath } from './pdf';

/**
 * OCR layer.
 *
 * A single tesseract.js worker is reused across requests (spawning one costs
 * ~600 ms). Preprocessing is done with sharp: photos of timetables are usually
 * phone shots — slightly rotated, low contrast, uneven lighting — and
 * grayscale + normalise + 2× upscale is worth roughly +15 confidence points.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let workerPromise: Promise<any> | null = null;
let workerBusy: Promise<unknown> = Promise.resolve();

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const langPath = tessdataPath();
      const corePath = tessCorePath();
      const worker = await createWorker('eng', 1, {
        langPath,
        corePath,
        gzip: true,
        cachePath: path.join(process.cwd(), '.cache', 'tesseract'),
        cacheMethod: 'none',
      });
      return worker;
    })();
  }
  return workerPromise;
}

export interface OcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
}

export interface OcrResult {
  text: string;
  confidence: number;
  words: OcrWord[];
  width: number;
  height: number;
}

export interface PreprocessVariant {
  name: string;
  buffer: Buffer;
  width: number;
  height: number;
}

const TARGET_WIDTH = 2000;

async function preprocess(input: Buffer): Promise<PreprocessVariant[]> {
  const meta = await sharp(input).metadata();
  const base = sharp(input).rotate();
  const width = meta.width ?? TARGET_WIDTH;
  const scale = Math.abs(width - TARGET_WIDTH) > 200 ? TARGET_WIDTH / width : 1;
  const resized = (pipeline: sharp.Sharp) =>
    pipeline
      .resize({
        width: Math.round(width * scale),
        withoutEnlargement: false,
        kernel: 'lanczos3',
      })
      .png();

  const variants: PreprocessVariant[] = [];

  const processed = await resized(
    base.clone().grayscale().normalize().sharpen({ sigma: 1 }),
  ).toBuffer({ resolveWithObject: true });
  variants.push({
    name: 'grayscale',
    buffer: processed.data,
    width: processed.info.width,
    height: processed.info.height,
  });

  const binarised = await resized(
    base.clone().grayscale().normalize().sharpen({ sigma: 1 }).threshold(170),
  ).toBuffer({ resolveWithObject: true });
  variants.push({
    name: 'threshold',
    buffer: binarised.data,
    width: binarised.info.width,
    height: binarised.info.height,
  });

  return variants;
}

const OCR_PARAMS = {
  tessedit_pageseg_mode: '6',
  preserve_interword_spaces: '1',
  user_defined_dpi: '300',
};

async function recogniseOnce(buffer: Buffer): Promise<{ text: string; confidence: number; words: OcrWord[] }> {
  const worker = await getWorker();
  // serialise access: one worker, one job at a time
  const job = workerBusy.then(async () => {
    await worker.setParameters(OCR_PARAMS);
    return worker.recognize(buffer, {}, { text: true, blocks: true });
  });
  workerBusy = job.catch(() => undefined);
  const result = await job;

  const data = result.data as {
    text: string;
    confidence: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    blocks?: any[] | null;
  };

  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = (word.text ?? '').trim();
          if (!text) continue;
          words.push({
            text,
            x: word.bbox.x0,
            y: word.bbox.y0,
            w: word.bbox.x1 - word.bbox.x0,
            h: word.bbox.y1 - word.bbox.y0,
            conf: typeof word.confidence === 'number' ? word.confidence : 0,
          });
        }
      }
    }
  }

  return { text: data.text ?? '', confidence: data.confidence ?? 0, words };
}

function score(words: OcrWord[]): number {
  return words.reduce((sum, w) => sum + (w.conf >= 55 ? w.text.length * w.conf : 0), 0);
}

export async function ocrImage(input: Buffer): Promise<OcrResult> {
  const variants = await preprocess(input);
  let best: { words: OcrWord[]; confidence: number; text: string; width: number; height: number; score: number } | null = null;

  for (const variant of variants) {
    const result = await recogniseOnce(variant.buffer);
    const value = score(result.words);
    if (!best || value > best.score) {
      best = { ...result, width: variant.width, height: variant.height, score: value };
    }
    // A clean first pass is good enough; skip the slower fallback.
    if (best.confidence > 82 && best.words.length > 40) break;
  }

  if (!best) return { text: '', confidence: 0, words: [], width: 0, height: 0 };

  // De-duplicate overlapping boxes (tesseract sometimes emits the same word twice
  // across blocks, which would double the text in a cell).
  const seen = new Set<string>();
  const words = best.words.filter((w) => {
    const key = `${w.text}|${Math.round(w.x / 4)}|${Math.round(w.y / 4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { ...best, words };
}

/** OCR result → the parser's page model. */
export function ocrToPages(result: OcrResult): Page[] {
  const words: Word[] = result.words.map((w) => ({
    text: w.text,
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
    conf: w.conf,
  }));
  const lines: Line[] = buildLines(words, result.width || 1000);
  return [{ index: 0, width: result.width || 1000, height: result.height || 1000, lines }];
}

export async function closeOcrWorker(): Promise<void> {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch {
    /* ignore */
  }
  workerPromise = null;
}

export function tessdataExists(): boolean {
  return fs.existsSync(path.join(tessdataPath(), 'eng.traineddata.gz')) ||
    fs.existsSync(path.join(tessdataPath(), 'eng.traineddata'));
}
