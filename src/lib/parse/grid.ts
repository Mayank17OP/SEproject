import type { Line, Page, ParseWarning, ParsedEvent } from '../types';
import { findDayTokens, findTimeRanges, fromHHMM, parseStartTime, parseTimeRange, toHHMM, type TimeRange } from '../time';
import { parseCell } from './cell';
import { median, normaliseText } from '../text';

/* ------------------------------------------------------------------ */
/* Anchors                                                             */
/* ------------------------------------------------------------------ */

interface DayAnchor {
  day: number;
  /** horizontal centre of the day token */
  x: number;
  /** midpoint of the token's line */
  y: number;
  h: number;
}

interface TimeAnchor {
  x: number;
  w: number;
  y: number;
  h: number;
  range: TimeRange;
}

interface Band {
  start: number;
  end: number;
  centre: number;
}

interface Column {
  band: Band;
  range: TimeRange;
}

/**
 * Locate day-of-week tokens with their horizontal position.
 * Works whether the label is its own word (the common case) or embedded in a
 * bigger text run (some PDFs emit the whole row as one string).
 */
function dayAnchorsOfLine(line: Line): DayAnchor[] {
  const anchors: DayAnchor[] = [];
  for (const word of line.words) {
    const tokens = findDayTokens(word.text);
    for (const token of tokens) {
      const charLen = Math.max(1, word.text.length);
      const startX = word.x + (token.index / charLen) * word.w;
      const width = (token.text.length / charLen) * word.w;
      anchors.push({
        day: token.day,
        x: startX + width / 2,
        y: line.y + line.h / 2,
        h: line.h,
      });
    }
  }
  return anchors;
}

function collectDayAnchors(page: Page): DayAnchor[] {
  return page.lines.flatMap(dayAnchorsOfLine);
}

/** Cluster values that are within `tolerance` of each other. */
function cluster(values: Array<{ value: number; day?: number }>, tolerance: number) {
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const clusters: Array<{ members: typeof values; centre: number }> = [];
  for (const item of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(item.value - last.centre) <= tolerance) {
      last.members.push(item);
      last.centre =
        last.members.reduce((s, m) => s + m.value, 0) / last.members.length;
    } else {
      clusters.push({ members: [item], centre: item.value });
    }
  }
  return clusters;
}

function distinctDays(anchors: DayAnchor[]): number {
  return new Set(anchors.map((a) => a.day)).size;
}

/* ------------------------------------------------------------------ */
/* Bands                                                               */
/* ------------------------------------------------------------------ */

function bandsFromCentres(centres: number[], min: number, max: number): Band[] {
  if (!centres.length) return [];
  const gaps: number[] = [];
  for (let i = 1; i < centres.length; i++) gaps.push(centres[i] - centres[i - 1]);
  const fallback = median(gaps) || 40;
  return centres.map((centre, i) => {
    const prev = i === 0 ? centre - fallback / 2 : (centres[i - 1] + centre) / 2;
    const next = i === centres.length - 1 ? centre + fallback / 2 : (centre + centres[i + 1]) / 2;
    return { start: Math.max(min, prev), end: Math.min(max, next), centre };
  });
}

/**
 * Estimate row bands from the vertical phase of the *content*.
 *
 * The hard part: day labels are usually printed at the top edge of their row,
 * but some layouts centre them. Midpoint bands therefore shift content into the
 * neighbouring day (the classic "teacher's name lands in Tuesday" bug).
 *
 * Fix: work in phase space. Fold every content line's y-position into one row
 * period relative to the labels, sort the phases, and find the largest circular
 * gap — that gap is the empty space between two rows, so the row boundary sits
 * right after it. This recovers both top-aligned and centre-aligned layouts
 * without guessing.
 */
function estimateBands(labelYs: number[], contentYs: number[], pageHeight: number): Band[] {
  if (!labelYs.length) return [];
  if (labelYs.length === 1) {
    const span = contentYs.length ? Math.max(...contentYs) - Math.min(...contentYs) : 0;
    const start = labelYs[0] - Math.max(12, span * 0.2);
    return [{ start: Math.max(0, start), end: pageHeight, centre: (start + pageHeight) / 2 }];
  }

  const gaps: number[] = [];
  for (let i = 1; i < labelYs.length; i++) gaps.push(labelYs[i] - labelYs[i - 1]);
  const period = median(gaps) || 48;
  const base = labelYs[0];

  let offset = 0;
  const usable = contentYs
    .filter((y) => y > base - period && y < labelYs[labelYs.length - 1] + period)
    .map((y) => ((y - base) % period + period) % period)
    .sort((a, b) => a - b);

  if (usable.length >= 2) {
    let bestGap = -1;
    let arcStart = 0;
    for (let i = 0; i < usable.length; i++) {
      const next = i === usable.length - 1 ? usable[0] + period : usable[i + 1];
      const gapSize = next - usable[i];
      if (gapSize > bestGap) {
        bestGap = gapSize;
        arcStart = next % period;
      }
    }
    // Arc start is the first content line of a row; put the boundary just above
    // it, keeping the offset within half a period of the label.
    offset = arcStart > period / 2 ? arcStart - period : arcStart;
    offset -= Math.min(6, Math.max(2, bestGap * 0.05));
  }

  const boundaries = labelYs.map((y) => y + offset);
  return boundaries.map((start, i) => {
    const end = i === boundaries.length - 1 ? start + period : boundaries[i + 1];
    return { start: Math.max(0, start), end: Math.min(pageHeight, end), centre: (start + end) / 2 };
  });
}

/* ------------------------------------------------------------------ */
/* Cell extraction                                                     */
/* ------------------------------------------------------------------ */

function cellText(lines: Line[], band: Band, x0: number, x1: number): { text: string; conf?: number; centre: number } {
  const rows: Array<{ y: number; parts: Array<{ x: number; text: string; conf?: number }>; confs: number[] }> = [];
  for (const line of lines) {
    const words = line.words.filter((w) => {
      const cx = w.x + w.w / 2;
      const cy = w.y + w.h / 2;
      return cx >= x0 && cx < x1 && cy >= band.start && cy < band.end;
    });
    if (!words.length) continue;
    const confs = words.map((w) => w.conf ?? 100);
    rows.push({
      y: line.y,
      parts: words.sort((a, b) => a.x - b.x).map((w) => ({ x: w.x, text: w.text, conf: w.conf })),
      confs,
    });
  }
  if (!rows.length) return { text: '', centre: (x0 + x1) / 2 };
  rows.sort((a, b) => a.y - b.y);
  const text = rows
    .map((row) => row.parts.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  const allConfs = rows.flatMap((r) => r.confs);
  const conf = allConfs.some((c) => c < 100) ? allConfs.reduce((a, b) => a + b, 0) / allConfs.length : undefined;
  const xs = rows.flatMap((r) => r.parts.map((p) => p.x));
  const centre = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : (x0 + x1) / 2;
  return { text, centre, conf };
}

/* ------------------------------------------------------------------ */
/* Time header resolution                                              */
/* ------------------------------------------------------------------ */

interface HeaderCell {
  x: number;
  w: number;
  range?: TimeRange;
  /** period label like "P1" / "I" / "1" when times are in a legend */
  period?: string;
}

function headerCellsFromLine(line: Line): HeaderCell[] {
  const cells: HeaderCell[] = [];
  for (const word of line.words) {
    const range = parseTimeRange(word.text);
    if (range) {
      cells.push({ x: word.x, w: word.w, range });
      continue;
    }
    const period = word.text.match(/^(?:P|PERIOD\s*)?([1-9]|1[0-2])(?:ST|ND|RD|TH)?$|^(P[1-9]|1[0-2])$/i);
    if (period) cells.push({ x: word.x, w: word.w, period: word.text.toUpperCase() });
  }
  // split a header word that contains several slashes ("9:00-9:55 / 10:00-10:55")
  return cells;
}

/** Parse a legend line such as "P1 9:00-9:55  P2 10:00-10:55" or "1st: 9:00-9:55". */
function legendTimes(lines: Line[]): Map<string, TimeRange> {
  const map = new Map<string, TimeRange>();
  for (const line of lines) {
    // A legend never contains weekday names (those are timetable rows).
    if (findDayTokens(line.text).length) continue;
    const marker = /(?:P|PERIOD\s*)(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\b/gi;
    let match: RegExpExecArray | null;
    while ((match = marker.exec(line.text))) {
      const period = Number(match[1] ?? match[2]);
      if (!period || period > 12) continue;
      const rest = line.text.slice(match.index + match[0].length, match.index + match[0].length + 28);
      const range = findTimeRanges(rest)[0];
      if (range) map.set(`P${period}`, { start: range.start, end: range.end, inferredEnd: false });
    }
  }
  return map;
}

function resolveRanges(
  cells: HeaderCell[],
  legend: Map<string, TimeRange>,
  warnings: ParseWarning[],
  page: number,
): TimeRange[] {
  const withRanges = cells.map((c) => {
    if (c.range) return c.range;
    if (c.period) {
      const key = /^\d+$/.test(c.period) ? `P${c.period}` : c.period;
      return legend.get(key) ?? null;
    }
    return null;
  });

  return withRanges.map((range, i) => {
    if (range) return range;
    const cell = cells[i];
    // A period label without a legend entry cannot be timed here.
    if (cell.period && /^(?:P?\d+)$/i.test(cell.period.trim())) {
      warnings.push({
        code: 'missing-time',
        page,
        message: `Period "${cell.period}" has no matching time in the legend, so those slots were skipped.`,
      });
      return null as unknown as TimeRange;
    }
    // Header only shows a start time ("9:00"): use the next start as the end.
    const startOnly = parseStartTime(cell.period ?? '');
    const start = startOnly ? parseStartTime(cell.period!) : null;
    const next = withRanges.slice(i + 1).find((r): r is TimeRange => Boolean(r));
    const nextCell = cells.slice(i + 1).find((c) => Boolean(parseStartTime(c.period ?? '')));
    if (start && nextCell) {
      const nextStart = parseStartTime(nextCell.period!);
      if (nextStart) {
        const startMin = fromHHMM(start.start);
        let endMin = fromHHMM(nextStart.start);
        if (endMin <= startMin) endMin += 12 * 60;
        if (endMin - startMin <= 4 * 60) {
          return { start: start.start, end: toHHMM(endMin), inferredEnd: true };
        }
      }
    }
    if (start && next) {
      return { start: start.start, end: next.start, inferredEnd: true };
    }
    warnings.push({
      code: 'missing-time',
      page,
      message: `A column header could not be read as a time ("${cell.period ?? '?'}"). Those slots were skipped — you can add them in the review step.`,
    });
    return null as unknown as TimeRange;
  });
}

/* ------------------------------------------------------------------ */
/* Main per-page parser                                                */
/* ------------------------------------------------------------------ */

interface PageParse {
  events: ParsedEvent[];
  warnings: ParseWarning[];
  layout: 'days-as-rows' | 'days-as-columns' | 'line-list' | 'none';
  cellsParsed: number;
  cellsEmpty: number;
}

const TIME_LABEL = /\d{1,2}\s*[:.]\s*\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?\s*(?:-|to|till)\s*\d{1,2}/i;

export function parsePage(page: Page): PageParse {
  const warnings: ParseWarning[] = [];
  const anchors = collectDayAnchors(page);
  if (!anchors.length) {
    return { ...lineListParse(page, warnings), layout: 'line-list' };
  }

  const xTolerance = Math.max(6, page.width * 0.012);
  const yTolerance = Math.max(5, page.height * 0.008);

  const rowClusters = cluster(anchors.map((a) => ({ value: a.y })), yTolerance);
  const bestRow = rowClusters.reduce(
    (best, c) => {
      const days = distinctDays(anchors.filter((a) => Math.abs(a.y - c.centre) <= yTolerance));
      return days > best.days ? { days, centre: c.centre } : best;
    },
    { days: 0, centre: 0 },
  );

  const columnClusters = cluster(anchors.map((a) => ({ value: a.x })), xTolerance);
  const bestColumn = columnClusters.reduce(
    (best, c) => {
      const days = distinctDays(anchors.filter((a) => Math.abs(a.x - c.centre) <= xTolerance));
      return days > best.days ? { days, centre: c.centre } : best;
    },
    { days: 0, centre: 0 },
  );

  // A single weekday label is not enough evidence of a table layout.
  if (bestRow.days < 1 && bestColumn.days < 1) {
    const fallback = lineListParse(page, warnings);
    if (fallback.events.length) return fallback;
    warnings.push({
      code: 'no-day-header',
      page: page.index,
      message: 'Could not find a row or column of weekday names. The file was scanned line by line instead.',
    });
    return { events: [], warnings, layout: 'none', cellsParsed: 0, cellsEmpty: 0 };
  }

  // Fewer distinct days but clearly a left-hand column of day names?
  const prefersRows =
    bestColumn.days > bestRow.days ||
    (bestColumn.days === bestRow.days && bestColumn.centre < page.width * 0.4);

  const attempt: ParseWarning[] = [];
  const result = prefersRows
    ? parseDaysAsRows(page, anchors, bestColumn.centre, xTolerance, attempt)
    : parseDaysAsColumns(page, anchors, bestRow.centre, yTolerance, attempt);

  if (result.events.length) {
    warnings.push(...attempt);
    return result;
  }

  // The grid did not yield anything usable — read the page line by line and
  // discard the grid attempt's "missing time" noise.
  const fallbackWarnings: ParseWarning[] = [];
  const fallback = lineListParse(page, fallbackWarnings);
  if (fallback.events.length) {
    warnings.push(...fallbackWarnings);
    return fallback;
  }
  warnings.push(...attempt, ...fallbackWarnings);
  return result;
}

/* --- Case 1: day names down the first column, times across the top -------- */

function parseDaysAsRows(
  page: Page,
  anchors: DayAnchor[],
  columnX: number,
  xTolerance: number,
  warnings: ParseWarning[],
): PageParse {
  const dayAnchors = anchors
    .filter((a) => Math.abs(a.x - columnX) <= xTolerance * 2)
    .sort((a, b) => a.y - b.y);

  // one anchor per day row (keep the first/last occurrence per day)
  const byDay = new Map<number, DayAnchor>();
  for (const a of dayAnchors) if (!byDay.has(a.day)) byDay.set(a.day, a);
  const rows = [...byDay.values()].sort((a, b) => a.y - b.y);
  if (!rows.length) {
    return { events: [], warnings, layout: 'days-as-rows', cellsParsed: 0, cellsEmpty: 0 };
  }

  const roughPeriod = median(rows.slice(1).map((r, i) => r.y - rows[i].y)) || page.height / 8;
  const dayColumnRight = Math.min(page.width, Math.max(...rows.map((r) => r.x)) + roughPeriod * 0.2);

  // Header: any line above the first day row that has time-ish content.
  const headerLines = page.lines
    .filter((l) => l.y + l.h <= rows[0].y + rows[0].h * 0.4)
    .filter((l) => l.words.some((w) => w.x > dayColumnRight - 4))
    .filter((l) => TIME_LABEL.test(l.text) || /\bP[1-9]\b/i.test(l.text) || /\d{1,2}\s*[:.]\s*\d{2}/.test(l.text));

  // Row bands: estimated from where the cell content actually sits, not from
  // the day labels. Labels are usually at the TOP of a row (so midpoint bands
  // would shift half a row and pull a teacher's name into the next day).
  const contentYs = page.lines
    .filter((l) => !headerLines.includes(l))
    .filter((l) => l.words.some((w) => w.x + w.w / 2 > dayColumnRight))
    .map((l) => l.y + l.h / 2);
  let rowBands = estimateBands(rows.map((r) => r.y), contentYs, page.height);
  if (rows.length === 1) {
    const span = contentYs.length ? Math.max(...contentYs) - Math.min(...contentYs) : 0;
    const start = rows[0].y - Math.max(12, span * 0.2);
    rowBands = [{ start: Math.max(0, start), end: page.height, centre: (start + page.height) / 2 }];
  }

  // Never reach up into the header row.
  const headerBottom = headerLines.reduce((max, l) => Math.max(max, l.y + l.h), 0);
  if (headerBottom > 0) rowBands[0].start = Math.max(rowBands[0].start, headerBottom + 1);

  const legend = legendTimes(page.lines);
  const headerCells = headerLines
    .filter((l) => TIME_LABEL.test(l.text) || /\bP[1-9]\b/i.test(l.text) || /\b\d{1,2}\s*[:.]\s*\d{2}\b.*\b\d{1,2}\s*[:.]\s*\d{2}\b/.test(l.text))
    .flatMap(headerCellsFromLine)
    .filter((c) => c.x > dayColumnRight - 10)
    .sort((a, b) => a.x - b.x);

  // Merge duplicate header cells picked up from multi-line headers.
  const merged: HeaderCell[] = [];
  for (const cell of headerCells) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.x - cell.x) < 4) {
      last.range = last.range ?? cell.range;
      last.period = last.period ?? cell.period;
      last.w = Math.max(last.w, cell.w);
    } else merged.push({ ...cell });
  }

  if (!merged.length && !legend.size) {
    warnings.push({
      code: 'missing-time',
      page: page.index,
      message: 'Found the weekday rows but no time header, so the slots could not be timed. Try a clearer photo or add times manually.',
    });
    return { events: [], warnings, layout: 'days-as-rows', cellsParsed: 0, cellsEmpty: 0 };
  }

  // If the header is period numbers, lay them out using the legend times.
  let ranges = merged.length ? resolveRanges(merged, legend, warnings, page.index) : [];
  if (!merged.length && legend.size) {
    ranges = [...legend.entries()]
      .sort((a, b) => fromHHMM(a[1].start) - fromHHMM(b[1].start))
      .map(([, r]) => r);
  }

  const centreXs = merged.length
    ? merged.map((c) => c.x + c.w / 2)
    : ranges.map((_, i) => dayColumnRight + ((page.width - dayColumnRight) / ranges.length) * (i + 0.5));
  const colBands = bandsFromCentres(centreXs, dayColumnRight - 2, page.width);

  const columns: Column[] = [];
  ranges.forEach((range, i) => {
    if (!range) return;
    columns.push({ band: colBands[i], range });
  });

  const events: ParsedEvent[] = [];
  const seen = new Set<string>();
  let cellsParsed = 0;
  let cellsEmpty = 0;

  rows.forEach((row, rowIndex) => {
    const band = rowBands[rowIndex];
    for (const column of columns) {
      const cell = cellText(page.lines, band, column.band.start, column.band.end);
      const clean = normaliseText(cell.text);
      if (!clean) {
        cellsEmpty++;
        continue;
      }
      const event = makeEvent(row.day, column.range, clean, page.index, warnings, cell.conf, {
        x0: column.band.start,
        x1: column.band.end,
        centre: cell.centre,
      });
      if (event && !seen.has(`${event.day}|${event.start}|${event.subject}`)) {
        seen.add(`${event.day}|${event.start}|${event.subject}`);
        events.push(event);
        cellsParsed++;
      }
    }
  });

  return { events, warnings, layout: 'days-as-rows', cellsParsed, cellsEmpty };
}

/* --- Case 2: day names across the top, times down the first column -------- */

function parseDaysAsColumns(
  page: Page,
  anchors: DayAnchor[],
  headerY: number,
  yTolerance: number,
  warnings: ParseWarning[],
): PageParse {
  const headerAnchors = anchors
    .filter((a) => Math.abs(a.y - headerY) <= yTolerance * 2)
    .sort((a, b) => a.x - b.x);

  const byDay = new Map<number, DayAnchor>();
  for (const a of headerAnchors) if (!byDay.has(a.day)) byDay.set(a.day, a);
  const cols = [...byDay.values()].sort((a, b) => a.x - b.x);
  if (!cols.length) {
    return { events: [], warnings, layout: 'days-as-columns', cellsParsed: 0, cellsEmpty: 0 };
  }

  // The time column is everything left of the day columns. Derive its right
  // edge from the actual time labels so a wide first column cannot swallow it.
  const timeWordRight = page.lines
    .flatMap((l) => l.words)
    .filter((w) => w.x < page.width * 0.45 && (parseTimeRange(w.text) || /^\d{1,2}[:.]\d{2}$/.test(w.text)))
    .reduce((max, w) => Math.max(max, w.x + w.w), 0);
  const tableLeftGuess = timeWordRight ? timeWordRight + 8 : Math.max(0, cols[0].x - 80);
  const tableLeft = Math.min(tableLeftGuess, cols[0].x - 8);
  const colBands = bandsFromCentres(cols.map((c) => c.x), tableLeft, page.width);
  if (cols.length === 1) {
    colBands[0].end = page.width;
  }

  const timeLines = page.lines
    .filter((l) => l.words.some((w) => w.x + w.w / 2 < tableLeft))
    .filter((l) => parseTimeRange(l.text) || TIME_LABEL.test(l.text))
    .map((l) => {
      const range = parseTimeRange(l.text);
      return range ? { y: l.y + l.h / 2, range } : null;
    })
    .filter((x): x is { y: number; range: TimeRange } => Boolean(x))
    .sort((a, b) => a.y - b.y);

  if (!timeLines.length) {
    warnings.push({
      code: 'missing-time',
      page: page.index,
      message: 'Found the weekday columns but no time labels down the left edge, so the slots could not be timed.',
    });
    return { events: [], warnings, layout: 'days-as-columns', cellsParsed: 0, cellsEmpty: 0 };
  }

  const rowBands = bandsFromCentres(timeLines.map((t) => t.y), 0, page.height);
  // Keep the day-header row out of the first time row.
  const dayHeaderBottom = page.lines
    .filter((l) => Math.abs(l.y + l.h / 2 - headerY) <= yTolerance * 2)
    .reduce((max, l) => Math.max(max, l.y + l.h), 0);
  if (dayHeaderBottom > 0) rowBands[0].start = Math.max(rowBands[0].start, dayHeaderBottom + 1);
  const events: ParsedEvent[] = [];
  const seen = new Set<string>();
  let cellsParsed = 0;
  let cellsEmpty = 0;

  rowBands.forEach((rowBand, rowIndex) => {
    const range = timeLines[rowIndex].range;
    cols.forEach((col, colIndex) => {
      const band = colBands[colIndex];
      const cell = cellText(page.lines, rowBand, band.start, band.end);
      const clean = normaliseText(cell.text);
      if (!clean) {
        cellsEmpty++;
        return;
      }
      const event = makeEvent(col.day, range, clean, page.index, warnings, cell.conf, {
        x0: band.start,
        x1: band.end,
        centre: cell.centre,
      });
      if (event && !seen.has(`${event.day}|${event.start}|${event.subject}`)) {
        seen.add(`${event.day}|${event.start}|${event.subject}`);
        events.push(event);
        cellsParsed++;
      }
    });
  });

  return { events, warnings, layout: 'days-as-columns', cellsParsed, cellsEmpty };
}

/* --- Case 3: free-form lines ("MON 9:00-10:00 DS Room 204 Dr Rao") -------- */

export function lineListParse(page: Page, warnings: ParseWarning[]): PageParse {
  const events: ParsedEvent[] = [];
  const legend = legendTimes(page.lines);
  for (const line of page.lines) {
    const range = parseTimeRange(line.text);
    if (!range) continue;
    const tokens = findDayTokens(line.text);
    if (!tokens.length) continue;
    const token = tokens[0];
    const rest = normaliseText(
      line.text
        .slice(0, token.index)
        .concat(' ', line.text.slice(token.index + token.text.length))
        .replace(
          /\b\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\s*(?:-|to|till)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?/i,
          ' ',
        ),
    );
    if (!rest) continue;
    const event = makeEvent(token.day, range, rest, page.index, warnings, line.conf);
    if (event) events.push(event);
  }
  if (events.length && !warnings.some((w) => w.code === 'fallback-parser')) {
    warnings.push({
      code: 'fallback-parser',
      page: page.index,
      message: 'No table grid detected — the timetable was read line by line. Please double-check times and rooms below.',
    });
  }
  void legend;
  return { events, warnings, layout: 'line-list', cellsParsed: events.length, cellsEmpty: 0 };
}

/* --- shared event factory ------------------------------------------------- */

function makeEvent(
  day: number,
  range: TimeRange,
  text: string,
  page: number,
  warnings: ParseWarning[],
  ocrConf: number | undefined,
  geometry?: { x0: number; x1: number; centre: number },
): ParsedEvent | null {
  const fields = parseCell(text);
  if (!fields.subject) return null;
  if (fields.kind === 'break') {
    // keep lunch/break markers, the exporter can filter them out
  }
  if (!fields.room || !fields.faculty) {
    if (fields.kind !== 'break') {
      warnings.push({
        code: 'partial-cell',
        page,
        message: `Only part of a cell could be read ("${text.replace(/\n/g, ' / ').slice(0, 60)}") — check the room/teacher for that slot.`,
      });
    }
  }
  if (typeof ocrConf === 'number' && ocrConf < 65) {
    warnings.push({
      code: 'low-ocr-confidence',
      page,
      message: `Low OCR confidence (${Math.round(ocrConf)}%) on "${text.replace(/\n/g, ' / ').slice(0, 40)}" — please verify.`,
    });
  }

  let confidence = fields.confidence;
  if (typeof ocrConf === 'number') confidence *= Math.min(1, 0.55 + ocrConf / 140);

  const id = `${day}-${range.start}-${Math.round(confidence * 1000)}-${Math.random().toString(36).slice(2, 7)}`;
  void geometry;
  return {
    id,
    day,
    start: range.start,
    end: range.end,
    subject: fields.subject,
    code: fields.code,
    room: fields.room,
    faculty: fields.faculty,
    kind: fields.kind,
    raw: text.replace(/\n/g, ' / '),
    confidence: Math.round(confidence * 100) / 100,
  };
}
