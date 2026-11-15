/**
 * Time + day parsing helpers.
 *
 * Timetables are written by humans, so the input is filthy:
 *   9:00-10:00   09.00 to 10.00   9 to 10   9:00 AM – 10:00 AM   0900-1000
 *   10:00-11:00 AM   1-2 pm   P1 9:00-9:55
 * All of those are supported and normalised to 24h "HH:MM".
 */

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const DAY_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

export const ICS_BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

const DAY_ALIASES: Record<string, number> = {
  SU: 0, SUN: 0, SUNDAY: 0,
  MO: 1, MON: 1, MONDAY: 1,
  TU: 2, TUE: 2, TUES: 2, TUESDAY: 2,
  WE: 3, WED: 3, WEDS: 3, WEDNESDAY: 3,
  TH: 4, THU: 4, THUR: 4, THURS: 4, THURSDAY: 4,
  FR: 5, FRI: 5, FRIDAY: 5,
  SA: 6, SAT: 6, SATURDAY: 6,
};

export interface DayToken {
  day: number;
  /** index in the original string */
  index: number;
  text: string;
}

/**
 * Find day-of-week tokens inside a line of text.
 * Tolerates OCR noise: "M0N" (zero for O), "TUE5", "WED." — and ignores
 * `DAY` tokens embedded in words such as "MONDAY" vs "MONTHLY".
 */
export function findDayTokens(text: string): DayToken[] {
  const out: DayToken[] = [];
  // normalise common OCR digit/letter confusions before matching
  const normalised = text
    .replace(/0/g, (m, i) => (isDigitZeroInDayWord(text, i) ? 'O' : m))
    .toUpperCase();

  const re = /(^|[^A-Z])(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY|MON|TUE|TUES|WED|WEDS|THU|THUR|THURS|FRI|SAT|SUN)(?![A-Z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalised))) {
    const word = m[2];
    const day = DAY_ALIASES[word];
    if (day === undefined) continue;
    out.push({ day, index: m.index + m[1].length, text: word });
    re.lastIndex = m.index + m[1].length + word.length;
  }
  return out;
}

/** Replace a leading zero inside a candidate day word ("M0N" → "MON"). */
function isDigitZeroInDayWord(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 2), index).toUpperCase();
  const after = text.slice(index + 1, index + 3).toUpperCase();
  return /[A-Z]$/.test(before) && /^[A-Z]/.test(after);
}

export interface TimeRange {
  /** "HH:MM" 24h */
  start: string;
  /** "HH:MM" 24h */
  end: string;
  /** true when the input only had a start time and the end was inferred/absent */
  inferredEnd: boolean;
}

const MERIDIEM = /(a\.?m\.?|p\.?m\.?)/i;

/** Convert "9:00 PM" / "9.30am" / "0900" / "9" to minutes from midnight. */
function toMinutes(raw: string, meridiem?: 'am' | 'pm'): number | null {
  const m = raw.match(/^(\d{1,2})(?:[:.]?(\d{2}))?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  if (meridiem === 'pm' && h < 12) h += 12;
  if (meridiem === 'am' && h === 12) h = 0;
  if (h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

export function toHHMM(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function fromHHMM(hhmm: string): number {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Try to read a time *range* out of a string.
 * Returns null when the string does not look like a range at all.
 */
export function parseTimeRange(input: string): TimeRange | null {
  const text = input
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;

  // "9:00 AM - 10:00 AM" | "09:00-10:00" | "9.00 to 10.00" | "0900-1000"
  const rangeRe =
    /(\d{1,2}(?:[:.]?\d{2})?)\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|to|till|through|–|—)\s*(\d{1,2}(?:[:.]?\d{2})?)\s*(a\.?m\.?|p\.?m\.?)?/i;
  const m = text.match(rangeRe);
  if (!m) return null;

  const startMer = m[2] ? (MERIDIEM.exec(m[2])![1].toLowerCase().startsWith('p') ? 'pm' : 'am') : undefined;
  const endMer = m[4] ? (MERIDIEM.exec(m[4])![1].toLowerCase().startsWith('p') ? 'pm' : 'am') : undefined;

  let start = toMinutes(m[1], startMer);
  let end = toMinutes(m[3], endMer);
  if (start === null || end === null) return null;

  // If only the end carries a meridiem ("10-11 AM"), it applies to both.
  if (!startMer && endMer) {
    if (endMer === 'pm' && start < end && start < 12) start += 12;
    if (endMer === 'am' && start >= 12) start -= 12;
  }
  // If the start carries it, the end inherits it ("10:00 AM - 11:00" → 11 AM).
  if (startMer && !endMer && endMer !== 'am' && endMer !== 'pm') {
    const startMin = start % 720;
    const cand = (end % 12) + (start >= 720 ? 720 : 0);
    if (cand > startMin || cand === 0) {
      // prefer the same half of the day as the start
      end = (end % 12) + (start >= 720 ? 720 : 0);
      if (end < start) end += 60 * 12;
    }
  }

  // "1-2" with no meridiem almost certainly means 13:00-14:00.
  if (!startMer && !endMer) {
    if (start < 7 * 60 && start > 0 && end <= 12 * 60) {
      start += 12 * 60;
      end += 12 * 60;
    }
  }
  if (end <= start) {
    if (end + 12 * 60 > start) end += 12 * 60;
    else return null;
  }
  if (end - start > 6 * 60) return null; // longer than a class block → not a time range

  return { start: toHHMM(start), end: toHHMM(end), inferredEnd: false };
}

/**
 * Try to read a single start time ("9:00", "09.30am", "P3" with a legend
 * resolved elsewhere). Used for headers that only show start times.
 */
export function parseStartTime(input: string): { start: string } | null {
  const text = input.replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim();
  const m = text.match(/(\d{1,2}(?:[:.]\d{2})?)\s*(a\.?m\.?|p\.?m\.?)?/i);
  if (!m) return null;
  const mer = m[2] ? (m[2].toLowerCase().startsWith('p') ? 'pm' : 'am') : undefined;
  let mins = toMinutes(m[1], mer);
  if (mins === null) return null;
  // A bare period slot between 1 and 6 with no meridiem is an afternoon slot.
  if (!mer && mins > 0 && mins < 7 * 60) mins += 12 * 60;
  return { start: toHHMM(mins) };
}

/** All time ranges in a string (used for legend rows: "P1 9:00-9:55  P2 10:00-10:55"). */
export function findTimeRanges(text: string, baseIndex = 0): Array<TimeRange & { index: number }> {
  const out: Array<TimeRange & { index: number }> = [];
  const re = /(\d{1,2}(?:[:.]\d{2})?)\s*(?:a\.?m\.?|p\.?m\.?)?\s*(?:-|to|till)\s*(\d{1,2}(?:[:.]\d{2})?)\s*(?:a\.?m\.?|p\.?m\.?)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const r = parseTimeRange(m[0]);
    if (r) out.push({ ...r, index: baseIndex + m.index });
  }
  return out;
}

/** "MON 9:00-10:00 DS 204" → day + range + the rest. */
export function splitDayTime(text: string): { day: number; range: TimeRange; rest: string } | null {
  const days = findDayTokens(text);
  if (!days.length) return null;
  const range = findTimeRanges(text)[0];
  if (!range) return null;
  const dt = days[0];
  // remove the day token and the text of the range from `rest`
  const after = text.slice(dt.index + dt.text.length);
  const rest = after.replace(/\b\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\s*(?:-|to|till)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?/i, ' ');
  return { day: dt.day, range, rest: rest.replace(/\s+/g, ' ').trim() };
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** "09:00" (24h) → "9:00 AM" for display. */
export function to12h(hhmm: string): string {
  const mins = fromHHMM(hhmm);
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const mer = h24 >= 12 ? 'PM' : 'AM';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, '0')} ${mer}`;
}
