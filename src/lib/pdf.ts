import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import type { Page, Word } from './types';
import { buildLines } from './text';

/**
 * PDF extraction, two-tier:
 *  1. The text layer, with coordinates (fast, exact) — used for digital PDFs.
 *  2. Rasterise the page and OCR it — used for scans/screenshots-in-PDF.
 * The caller decides which tier produced the pages (see `scannedPages`).
 */

export interface PdfExtract {
  pages: Page[];
  textChars: number;
  /** page indexes (0-based) that had no usable text layer */
  scannedPages: number[];
}

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod) => {
      // Keep pdf.js quiet in serverless logs and stop it from shelling out.
      const lib = (mod as unknown as { default?: PdfjsModule }).default ?? (mod as PdfjsModule);
      return lib;
    });
  }
  return pdfjsPromise;
}

export async function openPdf(data: Uint8Array) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  }).promise;
  return { doc, pdfjs };
}

const MIN_TEXT_CHARS = 60;

export async function extractPdf(data: Uint8Array): Promise<PdfExtract> {
  const { doc, pdfjs } = await openPdf(data);
  const pages: Page[] = [];
  const scannedPages: number[] = [];
  let textChars = 0;

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const words: Word[] = [];

      for (const item of content.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean }>) {
        if (typeof item.str !== 'string' || !item.str.trim() || !item.transform) continue;
        const tx = pdfjs.Util.transform(viewport.transform as unknown as number[], item.transform as number[]);
        const fontHeight = Math.hypot(tx[2], tx[3]) || 10;
        words.push({
          text: item.str,
          x: tx[4],
          y: tx[5] - fontHeight,
          w: item.width ?? item.str.length * fontHeight * 0.5,
          h: fontHeight,
        });
      }

      const pageTextChars = words.reduce((s, w) => s + w.text.replace(/\s/g, '').length, 0);
      textChars += pageTextChars;

      if (pageTextChars < MIN_TEXT_CHARS) {
        scannedPages.push(i - 1);
        pages.push({ index: i - 1, width: viewport.width, height: viewport.height, lines: [] });
      } else {
        pages.push({
          index: i - 1,
          width: viewport.width,
          height: viewport.height,
          lines: buildLines(words, viewport.width),
        });
      }
      page.cleanup();
    }
  } finally {
    void doc.destroy();
  }

  return { pages, textChars, scannedPages };
}

/** Rasterise a single PDF page at `scale` and return PNG bytes. */
export async function renderPdfPage(data: Uint8Array, pageIndex: number, scale = 2): Promise<{ png: Buffer; width: number; height: number }> {
  const { doc } = await openPdf(data);
  try {
    const page = await doc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    const png = await canvas.encode('png');
    page.cleanup();
    return { png: Buffer.from(png), width: canvas.width, height: canvas.height };
  } finally {
    void doc.destroy();
  }
}

export function tessdataPath(): string {
  return path.join(process.cwd(), 'vendor', 'tessdata');
}

export function tessCorePath(): string {
  return path.join(process.cwd(), 'vendor', 'tesseract-core');
}
