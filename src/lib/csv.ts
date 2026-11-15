import type { ExportOptions, ParsedEvent } from './types';
import { DAY_NAMES, to12h } from './time';
import { datesForWeekday } from './ics';

/** Human-friendly CSV (Google Sheets / Excel) with one row per class slot. */
export function buildCsv(events: ParsedEvent[], options: ExportOptions): string {
  const rows = [
    ['Day', 'Start', 'End', 'Subject', 'Code', 'Room', 'Faculty', 'Type', 'First class', 'Last class', 'Occurrences'],
  ];

  for (const event of events) {
    if (options.skipBreaks && event.kind === 'break') continue;
    const dates = datesForWeekday(options.startDate, options.endDate, event.day);
    rows.push([
      DAY_NAMES[event.day],
      to12h(event.start),
      to12h(event.end),
      event.subject,
      event.code ?? '',
      event.room ?? '',
      event.faculty ?? '',
      event.kind,
      dates[0] ?? '',
      dates[dates.length - 1] ?? '',
      String(dates.length),
    ]);
  }

  return rows
    .map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
    .join('\r\n');
}
