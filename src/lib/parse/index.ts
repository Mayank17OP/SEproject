import type { Page, ParseMeta, ParseResult, ParseWarning, SourceInfo, ParsedEvent } from '../types';
import { parsePage } from './grid';
import { eventKey } from './cell';
import { reconcileEvents } from './reconcile';

/**
 * Public entry point: pages in, weekly events out.
 *
 * Multiple pages are supported: several Indian colleges print Mon–Wed on page 1
 * and Thu–Sat on page 2. Duplicated slots (a lab block printed on both pages)
 * are de-duplicated by day + start + subject + room.
 */
export function parseTimetable(pages: Page[], source: SourceInfo): ParseResult {
  const events: ParsedEvent[] = [];
  const warnings: ParseWarning[] = [];
  const seen = new Map<string, ParsedEvent>();
  let layout: ParseMeta['layout'] = 'none';
  let cellsParsed = 0;
  let cellsEmpty = 0;
  let pagesUsed = 0;

  for (const page of pages) {
    const parsed = parsePage(page);
    warnings.push(...parsed.warnings);
    cellsParsed += parsed.cellsParsed;
    cellsEmpty += parsed.cellsEmpty;
    if (parsed.layout !== 'none' && layout === 'none') layout = parsed.layout;
    if (parsed.events.length) pagesUsed++;

    for (const event of parsed.events) {
      const key = eventKey(event);
      const existing = seen.get(key);
      if (existing) {
        // prefer the read with the higher confidence
        if (event.confidence > existing.confidence) {
          const idx = events.indexOf(existing);
          if (idx >= 0) events[idx] = event;
          seen.set(key, event);
        }
        continue;
      }
      seen.set(key, event);
      events.push(event);
    }
  }

  reconcileEvents(events);

  events.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start) || a.subject.localeCompare(b.subject));

  if (pages.length > 1 && pagesUsed > 1) {
    warnings.push({
      code: 'multiple-pages',
      message: `Your file has ${pages.length} pages; slots from ${pagesUsed} of them were merged into one calendar.`,
    });
  }

  if (source.kind !== 'pdf-text' && typeof source.ocrConfidence === 'number' && source.ocrConfidence < 70) {
    warnings.push({
      code: 'low-ocr-confidence',
      message: `Average OCR confidence was ${Math.round(source.ocrConfidence)}%. A sharper, straighter photo (or the original PDF) gives much better results.`,
    });
  }

  if (!events.length) {
    warnings.push({
      code: 'no-events',
      message:
        'No classes could be read from this file. Check that the timetable is upright and readable, or add the classes manually below.',
    });
  }

  // collapse near-duplicate warnings so the UI is not overwhelming
  const uniqueWarnings = dedupeWarnings(warnings);

  return {
    events,
    warnings: uniqueWarnings,
    meta: { layout, cellsParsed, cellsEmpty, pagesUsed },
    source,
  };
}

function dedupeWarnings(warnings: ParseWarning[]): ParseWarning[] {
  const counts = new Map<string, { warning: ParseWarning; count: number }>();
  for (const warning of warnings) {
    const key = `${warning.code}|${warning.message.replace(/"[^"]*"/g, '""')}`;
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { warning, count: 1 });
  }
  return [...counts.values()].map(({ warning, count }) =>
    count > 1 ? { ...warning, message: `${warning.message} (${count} similar)` } : warning,
  );
}

export { parsePage };
