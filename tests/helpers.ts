import { buildLines } from '../src/lib/text';
import type { Page, Word } from '../src/lib/types';

export interface GridSpec {
  /** header cells, e.g. ["09:00-09:55", "10:00-10:55"] */
  header: string[];
  /** first column labels, e.g. ["MON", "TUE"] */
  rowLabels: string[];
  /** cells[row][col], "\n" separates lines inside a cell */
  cells: Array<Array<string | null>>;
  /** row label column width */
  labelWidth?: number;
  colWidth?: number;
  rowHeight?: number;
  headerHeight?: number;
  width?: number;
  height?: number;
  /** put day labels across the top instead of down the left */
  transpose?: boolean;
  /** extra lines under the table (legends, footers) */
  footer?: string[];
}

const LINE_HEIGHT = 12;

/** Wrap long cell content so it stays inside its column, like a real table. */
function wrap(text: string, max = 26): string[] {
  return text
    .split('\n')
    .flatMap((line) =>
      line
        .split(' / ')
        .flatMap((part) => {
          const words = part.split(/\s+/);
          const lines: string[] = [];
          let current = '';
          for (const word of words) {
            if ((current + ' ' + word).trim().length > max) {
              if (current) lines.push(current.trim());
              current = word;
            } else {
              current = `${current} ${word}`;
            }
          }
          if (current.trim()) lines.push(current.trim());
          return lines;
        }),
    );
}

function wordsForText(text: string, x: number, y: number, maxChars = 26): Word[] {
  return wrap(text, maxChars).flatMap((line, lineIndex) =>
    line
      .split(/\s+/)
      .filter(Boolean)
      .reduce<{ words: Word[]; cursor: number }>(
        (state, token) => {
          const width = token.length * 5.4;
          state.words.push({
            text: token,
            x: x + state.cursor,
            y: y + lineIndex * LINE_HEIGHT,
            w: width,
            h: 10,
          });
          state.cursor += width + 3.6;
          return state;
        },
        { words: [], cursor: 0 },
      )
      .words,
  );
}

/** Build a synthetic "days as rows, times as columns" page (or its transpose). */
export function gridPage(spec: GridSpec, index = 0): Page {
  const labelWidth = spec.labelWidth ?? 70;
  const colWidth = spec.colWidth ?? 230;
  const rowHeight = spec.rowHeight ?? 78;
  const headerHeight = spec.headerHeight ?? 26;
  const width = spec.width ?? labelWidth + colWidth * spec.header.length + 20;
  const height = spec.height ?? headerHeight + rowHeight * spec.rowLabels.length + 60;
  const marginX = 10;
  const marginY = 10;
  const words: Word[] = [];

  const push = (text: string, x: number, y: number) => words.push(...wordsForText(text, x, y));

  if (!spec.transpose) {
    // header row: times across the top
    spec.header.forEach((label, c) => {
      push(label, marginX + labelWidth + c * colWidth + 6, marginY + 8);
    });
    spec.rowLabels.forEach((label, r) => {
      const rowY = marginY + headerHeight + r * rowHeight;
      push(label, marginX + 8, rowY + 6);
      spec.header.forEach((_, c) => {
        const cell = spec.cells[r]?.[c];
        if (cell) push(cell, marginX + labelWidth + c * colWidth + 8, rowY + 6);
      });
    });
  } else {
    // header row: days across the top, times down the left
    push('TIME', marginX + 8, marginY + 8);
    spec.header.forEach((label, c) => {
      push(label, marginX + labelWidth + c * colWidth + 8, marginY + 8);
    });
    spec.rowLabels.forEach((time, r) => {
      const rowY = marginY + headerHeight + r * rowHeight;
      push(time, marginX + 8, rowY + 6);
      spec.header.forEach((_, c) => {
        const cell = spec.cells[r]?.[c];
        if (cell) push(cell, marginX + labelWidth + c * colWidth + 8, rowY + 6);
      });
    });
  }

  const footerY = marginY + headerHeight + (spec.transpose ? spec.header.length : spec.rowLabels.length) * rowHeight + 8;
  (spec.footer ?? []).forEach((line, i) => push(line, marginX + 8, footerY + i * (LINE_HEIGHT + 4)));

  return { index, width, height, lines: buildLines(words, width) };
}

/** Free-form lines (what a bad OCR pass tends to look like). */
export function textPage(lines: string[], index = 0): Page {
  const words: Word[] = [];
  lines.forEach((line, i) => words.push(...wordsForText(line, 20, 20 + i * 20, 400)));
  const width = 800;
  return { index, width, height: Math.max(200, 40 + lines.length * 20), lines: buildLines(words, width) };
}
