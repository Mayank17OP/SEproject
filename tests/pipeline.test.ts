import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractPdf } from '../src/lib/pdf';
import { ocrImage, ocrToPages } from '../src/lib/ocr';
import { parseTimetable } from '../src/lib/parse';
import type { SourceInfo } from '../src/lib/types';
import { fromHHMM } from '../src/lib/time';

const sample = (name: string) => new Uint8Array(fs.readFileSync(path.join(process.cwd(), 'public/samples', name)));

const sourceInfo = (over: Partial<SourceInfo> = {}): SourceInfo => ({
  kind: 'pdf-text',
  fileName: 'sample.pdf',
  pages: 1,
  textChars: 0,
  ...over,
});

function summarise(result: ReturnType<typeof parseTimetable>) {
  return result.events.map((e) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][e.day]} ${e.start}-${e.end} | ${e.subject} | ${e.room ?? '-'} | ${e.faculty ?? '-'}`);
}

describe('PDF with weekdays down the left column', () => {
  it('extracts every slot with subject, room and faculty', async () => {
    const { pages, textChars, scannedPages } = await extractPdf(sample('cse-sem3.pdf'));
    expect(scannedPages).toHaveLength(0);
    expect(textChars).toBeGreaterThan(200);

    const result = parseTimetable(pages, sourceInfo({ textChars }));
    const lines = summarise(result);
    // 6 days × 6 slots, minus lunch, minus free, minus empty cells
    expect(result.meta.layout).toBe('days-as-rows');
    expect(result.events.length).toBeGreaterThanOrEqual(25);

    const mondayDs = result.events.find((e) => e.day === 1 && e.start === '09:00');
    expect(mondayDs).toBeTruthy();
    expect(mondayDs!.subject).toBe('Data Structures');
    expect(mondayDs!.code).toBe('CS301');
    expect(mondayDs!.room).toBe('LH-204');
    expect(mondayDs!.faculty).toBe('Dr. A. Kumar');
    expect(mondayDs!.end).toBe('09:55');

    const roomCell = result.events.find((e) => e.day === 1 && e.start === '11:00');
    expect(roomCell!.room).toBe('305');
    expect(roomCell!.faculty).toBe('Ms. N. Iyer');

    // Lunch is flagged as a break, not a class
    const lunch = result.events.find((e) => e.day === 1 && e.start === '14:00');
    expect(lunch?.kind).toBe('break');

    // Saturday's empty 11:00 slot produces nothing
    expect(result.events.some((e) => e.day === 6 && e.start === '11:00')).toBe(false);

    // sanity: every event starts before it ends
    for (const e of result.events) expect(fromHHMM(e.end)).toBeGreaterThan(fromHHMM(e.start));
    if (process.env.DEBUG_SAMPLES) console.log(lines.join('\n'));
  });
});

describe('PDF with weekdays across the top', () => {
  it('detects the transposed layout', async () => {
    const { pages } = await extractPdf(sample('days-across-top.pdf'));
    const result = parseTimetable(pages, sourceInfo({ fileName: 'days-across-top.pdf' }));
    expect(result.meta.layout).toBe('days-as-columns');
    expect(result.events.length).toBeGreaterThanOrEqual(20);

    // Tuesday column, 10:00 row → sample maps ROWS[tue][1]
    const tueSlot = result.events.find((e) => e.day === 2 && e.start === '10:00');
    expect(tueSlot).toBeTruthy();
    expect(tueSlot!.subject).toBe('Data Structures');
    expect(tueSlot!.room).toBe('LH-204');
    expect(tueSlot!.faculty).toBe('Dr. A. Kumar');
  });
});

describe('photo of a timetable (OCR path)', () => {
  it('reads the table from a compressed, slightly skewed JPEG', async () => {
    const ocr = await ocrImage(Buffer.from(sample('timetable-photo.jpg')));
    expect(ocr.words.length).toBeGreaterThan(60);

    const pages = ocrToPages(ocr);
    const result = parseTimetable(
      pages,
      sourceInfo({ kind: 'image-ocr', fileName: 'timetable-photo.jpg', ocrConfidence: ocr.confidence }),
    );
    if (process.env.DEBUG_SAMPLES) console.log(summarise(result).join('\n'), '\nconf', ocr.confidence);

    expect(result.meta.layout).toBe('days-as-rows');
    expect(result.events.length).toBeGreaterThanOrEqual(20);
    expect(result.events.some((e) => /Data Structures/i.test(e.subject))).toBe(true);
    expect(result.events.some((e) => (e.room ?? '').includes('LH-204'))).toBe(true);
    expect(result.events.some((e) => /Kumar/i.test(e.faculty ?? ''))).toBe(true);
  });
});
