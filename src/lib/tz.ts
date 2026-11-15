/**
 * Timezone utilities built only on `Intl` (no tz database shipped, works in
 * Node and in serverless runtimes).
 *
 * Why this exists: a weekly class is a *wall-clock* recurrence. If you store
 * 9:00 IST as 03:30Z and the attendee's calendar observes DST elsewhere, a UTC
 * based recurrence drifts by an hour twice a year. ICS solves this with
 * `DTSTART;TZID=...`, which needs a matching VTIMEZONE definition in the file.
 */

export interface OffsetTransition {
  /** epoch ms at which the new offset takes effect */
  at: number;
  /** offset (minutes east of UTC) before the transition */
  from: number;
  /** offset (minutes east of UTC) after the transition */
  to: number;
  /** abbreviation after the transition, e.g. "IST", "EDT" */
  name: string;
}

const MINUTE = 60_000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/** Offset of `timeZone` at instant `date`, in minutes east of UTC. */
export function zoneOffsetMinutes(timeZone: string, date: Date | number): number {
  const d = typeof date === 'number' ? new Date(date) : date;
  const parts = formatterFor(timeZone).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / MINUTE);
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}${mm}`;
}

/**
 * Common TZNAMEs. `Intl` reports a GMT offset (not "IST") for zones whose
 * abbreviation is not in CLDR's English short list, and a TZNAME with digits in
 * it upsets a few calendar clients.
 */
const KNOWN_ABBREVIATIONS: Record<string, string> = {
  'Asia/Kolkata': 'IST',
  'Asia/Calcutta': 'IST',
  'Asia/Colombo': 'IST',
  'Asia/Karachi': 'PKT',
  'Asia/Dhaka': 'BST',
  'Asia/Kathmandu': 'NPT',
  'Asia/Dubai': 'GST',
  'Asia/Singapore': 'SGT',
  'Asia/Tokyo': 'JST',
  'Asia/Shanghai': 'CST',
  'Europe/London': 'GB',
  UTC: 'UTC',
};

function abbreviation(timeZone: string, at: number): string {
  if (KNOWN_ABBREVIATIONS[timeZone] && zoneOffsetMinutes(timeZone, at) === zoneOffsetMinutes(timeZone, Date.UTC(2026, 0, 1))) {
    // only trust the fixed-offset map for zones that never change offset
    return KNOWN_ABBREVIATIONS[timeZone];
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(new Date(at));
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    const letters = raw.replace(/[^A-Za-z]/g, '');
    if (letters && !/^GMT$/i.test(letters)) return letters;
    const offset = zoneOffsetMinutes(timeZone, at);
    return `GMT${offset === 0 ? '' : formatOffset(offset)}`.replace(':', '');
  } catch {
    return 'LOCAL';
  }
}

/**
 * Find all offset transitions between two years by sampling every 6 days and
 * binary-searching down to the minute.
 */
export function findTransitions(timeZone: string, fromYear: number, toYear: number): OffsetTransition[] {
  const start = Date.UTC(fromYear, 0, 1);
  const end = Date.UTC(toYear + 1, 0, 1);
  const transitions: OffsetTransition[] = [];
  const step = 6 * 24 * 60 * MINUTE;

  let prevAt = start;
  let prevOffset = zoneOffsetMinutes(timeZone, start);

  for (let t = start + step; t <= end; t += step) {
    const offset = zoneOffsetMinutes(timeZone, t);
    if (offset !== prevOffset) {
      let lo = prevAt;
      let hi = t;
      while (hi - lo > MINUTE) {
        const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
        if (mid <= lo) break;
        if (zoneOffsetMinutes(timeZone, mid) === prevOffset) lo = mid;
        else hi = mid;
      }
      transitions.push({ at: hi, from: prevOffset, to: offset, name: abbreviation(timeZone, hi) });
      prevOffset = offset;
    }
    prevAt = t;
  }
  return transitions;
}

export interface VTimezoneComponent {
  kind: 'STANDARD' | 'DAYLIGHT';
  /** local wall-clock DTSTART in the *previous* offset, as "YYYYMMDDTHHMMSS" */
  dtstart: string;
  offsetFrom: number;
  offsetTo: number;
  name: string;
}

function wallClock(at: number, offsetMinutes: number): string {
  const d = new Date(at + offsetMinutes * MINUTE);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

export function buildVTimezoneComponents(timeZone: string, fromYear: number, toYear: number): VTimezoneComponent[] {
  const transitions = findTransitions(timeZone, fromYear, toYear);
  const components: VTimezoneComponent[] = [];
  const initialOffset = zoneOffsetMinutes(timeZone, Date.UTC(fromYear, 0, 1));
  components.push({
    kind: 'STANDARD',
    dtstart: '19700101T000000',
    offsetFrom: initialOffset,
    offsetTo: initialOffset,
    name: abbreviation(timeZone, Date.UTC(fromYear, 0, 1)),
  });
  for (const t of transitions) {
    components.push({
      kind: t.to > t.from ? 'DAYLIGHT' : 'STANDARD',
      dtstart: wallClock(t.at, t.from),
      offsetFrom: t.from,
      offsetTo: t.to,
      name: t.name,
    });
  }
  return components;
}

/** Convert a wall-clock time in `timeZone` to epoch ms (handles DST gaps/overlaps). */
export function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number, // 1-12
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = zoneOffsetMinutes(timeZone, guess);
  let utc = guess - offset * MINUTE;
  // one correction pass is enough for real zones, two is bullet-proof
  for (let i = 0; i < 2; i++) {
    const nextOffset = zoneOffsetMinutes(timeZone, utc);
    if (nextOffset === offset) break;
    offset = nextOffset;
    utc = guess - offset * MINUTE;
  }
  return utc;
}

/** ISO "YYYY-MM-DD" plus a wall-clock "HH:MM" in `timeZone` → "YYYYMMDDTHHMMSS". */
export function localStamp(isoDate: string, hhmm: string): string {
  return `${isoDate.replace(/-/g, '')}T${hhmm.replace(':', '')}00`;
}

/** "YYYYMMDDTHHMMSSZ" for an instant. */
export function utcStamp(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const COMMON_TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
];
