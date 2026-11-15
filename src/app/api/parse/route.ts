import { NextResponse } from 'next/server';
import { extractPdf, renderPdfPage } from '@/lib/pdf';
import { ocrImage, ocrToPages } from '@/lib/ocr';
import { parseTimetable } from '@/lib/parse';
import type { Page, SourceInfo } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 60 s keeps this deployable on Vercel's Hobby plan; OCR needs ~10–12 s cold.
export const maxDuration = 60;

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_OCR_PAGES = 3;

export async function POST(request: Request) {
  const started = Date.now();
  let file: File | null = null;

  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Send the timetable as multipart/form-data with a "file" field.' }, { status: 415 });
    }
    const form = await request.formData();
    const uploaded = form.get('file');
    if (!(uploaded instanceof File)) {
      return NextResponse.json({ error: 'No file was uploaded.' }, { status: 400 });
    }
    file = uploaded;
  } catch {
    return NextResponse.json({ error: 'The upload could not be read. Try a smaller file.' }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `That file is ${(file.size / 1e6).toFixed(1)} MB — the limit is 12 MB.` }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name || 'timetable';
  const isPdf = buffer.subarray(0, 5).toString('latin1') === '%PDF-' || /\.pdf$/i.test(name);
  const isImage = /^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(name);

  if (!isPdf && !isImage) {
    return NextResponse.json(
      { error: 'Please upload a PDF or a photo/scan of your timetable (PNG, JPG, WEBP).' },
      { status: 415 },
    );
  }

  try {
    let pages: Page[] = [];
    let source: SourceInfo;
    const warningsFromExtraction: string[] = [];

    if (isPdf) {
      const pdf = await extractPdf(new Uint8Array(buffer));
      pages = pdf.pages;

      if (pdf.scannedPages.length) {
        // Scanned PDF (or a PDF export of a screenshot): OCR the raster.
        const toOcr = pdf.scannedPages.slice(0, MAX_OCR_PAGES);
        const ocrResults = [];
        for (const index of toOcr) {
          const rendered = await renderPdfPage(new Uint8Array(buffer), index, 2);
          const ocr = await ocrImage(rendered.png);
          ocrResults.push({ index, ocr });
        }
        for (const { index, ocr } of ocrResults) {
          const [ocrPage] = ocrToPages(ocr);
          pages[index] = { ...ocrPage, index };
        }
        const meanConfidence =
          ocrResults.reduce((sum, r) => sum + r.ocr.confidence, 0) / Math.max(1, ocrResults.length);

        source = {
          kind: 'pdf-ocr',
          fileName: name,
          pages: pdf.pages.length,
          textChars: pdf.textChars,
          ocrConfidence: meanConfidence,
          extractMs: Date.now() - started,
        };
        if (pdf.scannedPages.length > MAX_OCR_PAGES) {
          warningsFromExtraction.push(
            `Only the first ${MAX_OCR_PAGES} scanned pages were read — add the rest manually if needed.`,
          );
        }
      } else {
        source = {
          kind: 'pdf-text',
          fileName: name,
          pages: pdf.pages.length,
          textChars: pdf.textChars,
          extractMs: Date.now() - started,
        };
      }
    } else {
      const ocr = await ocrImage(buffer);
      pages = ocrToPages(ocr);
      source = {
        kind: 'image-ocr',
        fileName: name,
        pages: 1,
        textChars: 0,
        ocrConfidence: ocr.confidence,
        extractMs: Date.now() - started,
      };
    }

    const result = parseTimetable(pages, { ...source, extractMs: Date.now() - started });

    if (warningsFromExtraction.length) {
      result.warnings.push(
        ...warningsFromExtraction.map((message) => ({ code: 'multiple-pages' as const, message })),
      );
    }

    return NextResponse.json({
      ...result,
      fileMeta: { name, size: buffer.length, isPdf },
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    console.error('[parse] failed', error);
    const detail = error instanceof Error ? error.message : String(error);
    let message =
      'The file could not be read. A clearer photo (straight, well-lit) or the original PDF usually works.';
    if (/password|encrypt/i.test(detail)) {
      message = 'This PDF is password-protected or encrypted. Please upload an unlocked copy.';
    } else if (/traineddata|tesseract-core|\.wasm|ENOENT.*vendor/i.test(detail)) {
      console.error('[parse] OCR assets missing — run `npm install` (postinstall vendors them).');
      message =
        'The OCR model is not installed on this server. Run `npm install` to vendor it, or upload a PDF with a text layer.';
    }
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
