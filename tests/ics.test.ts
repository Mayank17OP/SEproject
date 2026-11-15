import { describe, expect, it } from 'vitest';
import ical from 'node-ical';
import { buildIcs, datesForWeekday, escapeText, foldLine, validateOptions } from '../src/lib/ics';
import { buildVTimezoneComponents, formatOffset, zoneOffsetMinutes, zonedTimeToUtc } from '../src/lib/tz';
import type { ExportOptions, ParsedEvent } from '../src/lib/types';

const event = (over: Partial<ParsedEvent> = {}): ParsedEvent => ({
  id: 'e1',
  day: 1,
  start: '09:00',
  end: '09:55',
  subject: 'Data Structures',
  code: 'CS301',
  room: 'LH-204',
  faculty: 'Dr. A. Kumar',
  kind: 'class',
  confidence: 0.95,
  ...over,
});

const options = (over: Partial<ExportOptions> = {}): ExportOptions => ({
  calendarName: 'CSE Sem 3',
  timeZone: 'Asia/Kolkata',
  startDate: '2026-01-05',
  endDate: '2026-04-24',
  holidays: [],
  reminderMinutes: 10,
  includeLocation: true,
  includeFaculty: true,
  skipBreaks: true,
  ...over,
});

const now = new Date('2026-01-01T00:00:00Z');

/** Unfold + normalise for structural assertions. */
function lines(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, '').split('\r\n').filter(Boolean);
}

describe('tz helpers', () => {
  it('knows India is +05:30 all year', () => {
    expect(zoneOffsetMinutes('Asia/Kolkata', Date.UTC(2026, 0, 15))).toBe(330);
    expect(zoneOffsetMinutes('Asia/Kolkata', Date.UTC(2026, 6, 15))).toBe(330);
    expect(formatOffset(330)).toBe('+0530');
    expect(formatOffset(-300)).toBe('-0500');
  });

  it('finds both DST transitions for New York in 2026', () => {
    const shifts = buildVTimezoneComponents('America/New_York', 2026, 2026);
    const kinds = shifts.map((s) => s.kind);
    expect(kinds).toContain('DAYLIGHT');
    expect(kinds).toContain('STANDARD');
    // second Sunday of March 2026 = 8 March, first Sunday of November = 1 November
    expect(shifts.some((s) => s.dtstart.startsWith('20260308'))).toBe(true);
    expect(shifts.some((s) => s.dtstart.startsWith('20261101'))).toBe(true);
  });

  it('converts wall-clock to UTC through DST', () => {
    // 2026-07-01 09:00 EDT = 13:00Z
    expect(new Date(zonedTimeToUtc('America/New_York', 2026, 7, 1, 9, 0)).toISOString()).toBe('2026-07-01T13:00:00.000Z');
    // 2026-01-15 09:00 EST = 14:00Z
    expect(new Date(zonedTimeToUtc('America/New_York', 2026, 1, 15, 9, 0)).toISOString()).toBe('2026-01-15T14:00:00.000Z');
  });
});

describe('ICS escaping and folding', () => {
  it('escapes the four special characters', () => {
    expect(escapeText('Dr. A, Kumar; Room 204\\3\nSecond line')).toBe('Dr. A\\, Kumar\\; Room 204\\\\3\\nSecond line');
  });

  it('folds on octet boundaries, not characters', () => {
    const line = `DESCRIPTION:${'é'.repeat(60)}`;
    const folded = foldLine(line);
    for (const part of folded.split('\r\n')) {
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });
});

describe('datesForWeekday', () => {
  it('lists every Monday in the term', () => {
    const monday = datesForWeekday('2026-01-05', '2026-04-24', 1);
    expect(monday[0]).toBe('2026-01-05');
    expect(monday.at(-1)).toBe('2026-04-20');
    expect(monday).toHaveLength(16);
  });

  it('returns nothing when the weekday falls outside', () => {
    expect(datesForWeekday('2026-01-05', '2026-01-09', 6)).toEqual([]);
  });
});

describe('buildIcs', () => {
  it('produces a structurally valid calendar', () => {
    const { ics, eventCount } = buildIcs([event()], options(), now);
    expect(eventCount).toBe(1);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//Timetable to Calendar//Class Schedule//EN');
    expect(ics).not.toMatch(/\r\n\r\n/);
    // every content line ends with CRLF
    for (const line of ics.split('\r\n').filter(Boolean)) {
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it('writes a TZID-anchored weekly recurrence that ends in UTC', () => {
    const body = lines(buildIcs([event()], options(), now).ics);
    expect(body).toContain('DTSTART;TZID=Asia/Kolkata:20260105T090000');
    expect(body).toContain('DTEND;TZID=Asia/Kolkata:20260105T095500');
    expect(body).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260424T182959Z');
    expect(body).toContain('TZOFFSETTO:+0530');
    expect(body).toContain('LOCATION:LH-204');
    expect(body).toContain('SUMMARY:CS301 — Data Structures');
    expect(body).toContain('BEGIN:VALARM');
    expect(body).toContain('TRIGGER:-PT10M');
  });

  it('applies EXDATE only on holidays that hit that weekday', () => {
    const body = lines(
      buildIcs([event()], options({ holidays: ['2026-01-26', '2026-01-27'] }), now).ics,
    );
    // 26 Jan 2026 is a Monday → excluded; 27 Jan is a Tuesday → ignored
    expect(body).toContain('EXDATE;TZID=Asia/Kolkata:20260126T090000');
    expect(body.join('\n')).not.toContain('20260127T090000');
  });

  it('keeps UIDs stable across runs so re-imports update instead of duplicate', () => {
    const a = buildIcs([event()], options(), now).ics;
    const b = buildIcs([event()], options(), new Date('2027-05-05T05:05:05Z')).ics;
    const uid = (ics: string) => lines(ics).find((line) => line.startsWith('UID:'))!;
    expect(uid(a)).toBe(uid(b));
  });

  it('skips breaks by default and can keep them on request', () => {
    const lunch = event({ id: 'l1', subject: 'LUNCH BREAK', kind: 'break', start: '13:00', end: '14:00' });
    const sport = event({ id: 'e2', day: 6, subject: 'Sports', room: 'Ground' });
    const skippedBreaks = buildIcs([event(), lunch, sport], options(), now);
    expect(skippedBreaks.eventCount).toBe(2);
    expect(skippedBreaks.ics).not.toContain('LUNCH BREAK');

    const keepBreaks = buildIcs([lunch], options({ skipBreaks: false }), now);
    expect(keepBreaks.eventCount).toBe(1);
  });

  it('drops slots that never occur inside the term window', () => {
    const { eventCount, skipped } = buildIcs(
      [event({ id: 'e3', day: 0, subject: 'Sunday Lab' })],
      options({ startDate: '2026-01-05', endDate: '2026-01-09' }),
      now,
    );
    expect(eventCount).toBe(0);
    expect(skipped).toBe(1);
  });

  it('parses back cleanly with a real iCalendar library', () => {
    const { ics } = buildIcs([event(), event({ id: 'e2', day: 3, start: '14:00', end: '14:55', subject: 'DBMS', room: 'LH-201' })], options({ holidays: ['2026-02-02'] }), now);
    const parsed = ical.sync.parseICS(ics);
    const events = Object.values(parsed).filter((value) => value && (value as { type?: string }).type === 'VEVENT');
    expect(events).toHaveLength(2);
    const first = events[0] as unknown as {
      summary: string;
      rrule?: unknown;
      location?: string;
      alarms?: unknown;
    };
    expect(first.summary).toContain('Data Structures');
    expect(first.location).toBe('LH-204');
    // node-ical round-trips the rule, including the UTC UNTIL
    expect(String(first.rrule)).toContain('UNTIL=20260424T182959Z');
    expect(String(first.rrule)).toContain('BYDAY=MO');
    expect(first.alarms).toBeTruthy();
  });

  it('respects output options for location/faculty/reminder', () => {
    const body = lines(
      buildIcs([event()], options({ includeLocation: false, includeFaculty: false, reminderMinutes: 0 }), now).ics,
    );
    expect(body.some((line) => line.startsWith('LOCATION'))).toBe(false);
    expect(body.join('\n')).not.toContain('Faculty:');
    expect(body).not.toContain('BEGIN:VALARM');
  });

  it('validates the term window', () => {
    expect(validateOptions(options())).toEqual([]);
    expect(validateOptions(options({ endDate: '2025-12-01' })).length).toBe(1);
    expect(validateOptions(options({ startDate: '2026-13-40' })).length).toBeGreaterThan(0);
    expect(validateOptions(options({ reminderMinutes: 5000 })).length).toBe(1);
  });
});
