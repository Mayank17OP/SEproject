import type { Line, Page, Word } from './types';

/**
 * Group words into lines by baseline proximity, then sort.
 * Both extractors (PDF text layer, OCR blocks) funnel through this so the
 * grid parser only ever deals with `Page`.
 */
export function buildLines(words: Word[], pageWidth: number): Line[] {
  const usable = words
    .map((w) => ({ ...w, text: w.text.replace(/\u00a0/g, ' ').trim() }))
    .filter((w) => w.text.length > 0);

  if (!usable.length) return [];

  const tolerance = Math.max(3, pageWidth * 0.004);
  const sorted = [...usable].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);

  const groups: Word[][] = [];
  let current: Word[] = [];
  let currentCenter = 0;
  for (const word of sorted) {
    const center = word.y + word.h / 2;
    if (!current.length) {
      current = [word];
      currentCenter = center;
      continue;
    }
    if (Math.abs(center - currentCenter) <= Math.max(tolerance, word.h * 0.6)) {
      current.push(word);
      currentCenter = (currentCenter * (current.length - 1) + center) / current.length;
    } else {
      groups.push(current);
      current = [word];
      currentCenter = center;
    }
  }
  if (current.length) groups.push(current);

  return groups
    .map((group) => makeLine(group, pageWidth))
    .filter((line) => line.words.length > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function makeLine(words: Word[], pageWidth: number): Line {
  const sorted = [...words].sort((a, b) => a.x - b.x);
  const x = Math.min(...sorted.map((w) => w.x));
  const y = Math.min(...sorted.map((w) => w.y));
  const h = Math.max(...sorted.map((w) => w.y + w.h)) - y;
  const gap = Math.max(1.2, pageWidth * 0.002);
  let text = '';
  let prevEnd: number | null = null;
  for (const w of sorted) {
    if (prevEnd !== null) {
      const space = w.x - prevEnd;
      // Keep a single space when tokens are separated; add a double space for
      // wide table gutters so downstream heuristics can still see the columns.
      if (space > gap) text += space > 24 ? '  ' : ' ';
    }
    text += w.text;
    prevEnd = w.x + w.w;
  }
  const conf = sorted.every((w) => typeof w.conf === 'number')
    ? sorted.reduce((s, w) => s + (w.conf ?? 0), 0) / sorted.length
    : undefined;
  return { words: sorted, text, x, y, h, conf };
}

export function pageWords(page: Page): Word[] {
  return page.lines.flatMap((l) => l.words);
}

/** Cheap "is there a real text layer here?" test. */
export function textCharCount(pages: Page[]): number {
  return pages.reduce(
    (sum, p) => sum + p.lines.reduce((s, l) => s + l.text.replace(/\s/g, '').length, 0),
    0,
  );
}

/**
 * Strip characters OCR likes to inject and normalise unicode punctuation.
 * Deliberately conservative: we keep letters, digits and the punctuation the
 * parser relies on (`: . - / ( ) & ,`).
 */
export function normaliseText(input: string): string {
  return input
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/[|¦]/g, ' ')
    .replace(/[€©¢₵]/g, 'C')
    .replace(/\s+/g, ' ')
    .trim();
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
