import type { ExportOptions, ParsedEvent } from './types';
import { ICS_BYDAY, fromHHMM } from './time';
import { buildVTimezoneComponents, formatOffset, localStamp, utcStamp, zonedTimeToUtc } from './tz';

/**
 * RFC 5545 writer.
 *
 * The parts that actually break in the wild, all handled here:
 *  - CRLF line endings and 75-octet folding (counting *bytes*, not characters,
 *    otherwise a faculty name with an accent corrupts the file)
 *  - TEXT escaping (`,` `;` `\` and newlines)
 *  - VTIMEZONE for the wall-clock TZID used by DTSTART/DTEND/EXDATE
 *  - RRULE with a UTC UNTIL (RFC requires UTC when DTSTART is a TZID value)
 *  - EXDATE for holidays, only on dates where the class would actually occur
 *  - stable UIDs so re-importing replaces instead of duplicating
 */

const PRODID = '-//Timetable to Calendar//Class Schedule//EN';

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold a content line to 75 octets, continuation lines start with a space. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (currentBytes + bytes > 75) {
      lines.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += bytes;
  }
  lines.push(current);
  return lines.join('\r\n ');
}

function icsDate(isoDate: string): { y: number; m: number; d: number } | null {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** All dates (ISO) between start and end that fall on `weekday`, capped for sanity. */
export function datesForWeekday(startDate: string, endDate: string, weekday: number): string[] {
  const start = icsDate(startDate);
  const end = icsDate(endDate);
  if (!start || !end) return [];
  const cursor = new Date(Date.UTC(start.y, start.m - 1, start.d));
  const last = new Date(Date.UTC(end.y, end.m - 1, end.d));
  if (cursor > last) return [];
  while (cursor.getUTCDay() !== weekday) cursor.setUTCDate(cursor.getUTCDate() + 1);
  const out: string[] = [];
  while (cursor <= last && out.length < 400) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return out;
}

function uidFor(event: ParsedEvent): string {
  const base = `${event.subject}|${event.code ?? ''}|${event.day}|${event.start}|${event.end}|${event.room ?? ''}`;
  let hash = 5381;
  for (let i = 0; i < base.length; i++) hash = ((hash << 5) + hash + base.charCodeAt(i)) >>> 0;
  return `ttc-${hash.toString(36)}-${event.day}${event.start.replace(':', '')}@timetable-to-calendar`;
}

export interface IcsBuildResult {
  ics: string;
  eventCount: number;
  skipped: number;
  /** ISO timestamp used for DTSTAMP — injectable so tests are deterministic */
}

export function buildIcs(
  events: ParsedEvent[],
  options: ExportOptions,
  now: Date = new Date(),
): IcsBuildResult {
  const tz = options.timeZone;
  const startYear = Number(options.startDate.slice(0, 4)) || now.getUTCFullYear();
  const endYear = Number(options.endDate.slice(0, 4)) || startYear;
  const stamp = utcStamp(now.getTime());

  const include = events.filter((e) => {
    if (options.skipBreaks && e.kind === 'break') return false;
    if (!e.subject) return false;
    if (fromHHMM(e.end) <= fromHHMM(e.start)) return false;
    return true;
  });

  const holidays = new Set(options.holidays.map((h) => h.trim()).filter(Boolean));
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.calendarName || 'Class Timetable')}`,
    `X-WR-TIMEZONE:${tz}`,
    'X-PUBLISHED-TTL:PT12H',
    'BEGIN:VTIMEZONE',
    `TZID:${tz}`,
    `X-LIC-LOCATION:${tz}`,
  ];

  for (const component of buildVTimezoneComponents(tz, Math.min(startYear, endYear), Math.max(startYear, endYear))) {
    lines.push(
      `BEGIN:${component.kind}`,
      `DTSTART:${component.dtstart}`,
      `TZOFFSETFROM:${formatOffset(component.offsetFrom)}`,
      `TZOFFSETTO:${formatOffset(component.offsetTo)}`,
      `TZNAME:${component.name}`,
      `END:${component.kind}`,
    );
  }
  lines.push('END:VTIMEZONE');

  let eventCount = 0;
  let skipped = 0;

  for (const event of include) {
    const dates = datesForWeekday(options.startDate, options.endDate, event.day);
    if (!dates.length) {
      skipped++;
      continue;
    }
    const firstDate = dates[0];
    const dtStart = localStamp(firstDate, event.start);
    const dtEnd = localStamp(firstDate, event.end);

    const summaryParts = [event.code, event.subject].filter(Boolean) as string[];
    const descriptionParts: string[] = [];
    if (event.subject) descriptionParts.push(`Course: ${event.subject}`);
    if (event.code) descriptionParts.push(`Code: ${event.code}`);
    if (options.includeFaculty && event.faculty) descriptionParts.push(`Faculty: ${event.faculty}`);
    if (event.room) descriptionParts.push(`Room: ${event.room}`);
    if (event.kind === 'lab') descriptionParts.push('Type: Lab / Practical');

    const endOfDayUtc = zonedTimeToUtc(
      tz,
      Number(options.endDate.slice(0, 4)),
      Number(options.endDate.slice(5, 7)),
      Number(options.endDate.slice(8, 10)),
      23,
      59,
      59,
    );

    const eventLines: string[] = [
      'BEGIN:VEVENT',
      `UID:${uidFor(event)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${tz}:${dtStart}`,
      `DTEND;TZID=${tz}:${dtEnd}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${ICS_BYDAY[event.day]};UNTIL=${utcStamp(endOfDayUtc)}`,
    ];

    const exdates = dates.filter((d) => holidays.has(d));
    if (exdates.length) {
      eventLines.push(`EXDATE;TZID=${tz}:${exdates.map((d) => localStamp(d, event.start)).join(',')}`);
    }

    eventLines.push(`SUMMARY:${escapeText(summaryParts.join(' — '))}`);
    if (options.includeLocation && event.room) eventLines.push(`LOCATION:${escapeText(event.room)}`);
    if (descriptionParts.length) eventLines.push(`DESCRIPTION:${escapeText(descriptionParts.join('\n'))}`);
    eventLines.push('CATEGORIES:Class', 'STATUS:CONFIRMED', 'TRANSP:OPAQUE');

    if (options.reminderMinutes > 0) {
      eventLines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(summaryParts.join(' — ') || 'Class')} starts soon`,
        `TRIGGER:-PT${Math.round(options.reminderMinutes)}M`,
        'END:VALARM',
      );
    }
    eventLines.push('END:VEVENT');

    for (const line of eventLines) lines.push(line);
    eventCount++;
  }

  lines.push('END:VCALENDAR');

  const ics = lines.map(foldLine).join('\r\n') + '\r\n';
  return { ics, eventCount, skipped };
}

export function validateOptions(options: ExportOptions): string[] {
  const errors: string[] = [];
  if (!icsDate(options.startDate)) errors.push('Term start date is missing or invalid.');
  if (!icsDate(options.endDate)) errors.push('Term end date is missing or invalid.');
  if (icsDate(options.startDate) && icsDate(options.endDate) && options.endDate < options.startDate) {
    errors.push('Term end date must be after the start date.');
  }
  if (options.reminderMinutes < 0 || options.reminderMinutes > 1440) {
    errors.push('Reminder must be between 0 and 1440 minutes.');
  }
  const span = icsDate(options.startDate) && icsDate(options.endDate)
    ? (Date.parse(options.endDate) - Date.parse(options.startDate)) / 86_400_000
    : 0;
  if (span > 370) errors.push('Keep the term under about a year (max 370 days).');
  for (const holiday of options.holidays) {
    if (holiday && !icsDate(holiday)) errors.push(`Holiday "${holiday}" is not a valid date.`);
  }
  return errors;
}
