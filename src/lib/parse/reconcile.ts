import type { ParsedEvent } from '../types';

/**
 * Cross-cell reconciliation.
 *
 * A timetable repeats the same subject, teacher and room all week. OCR gets a
 * few of them wrong ("€s301", "Prof. 5. Rao", "Ms. N. lyer") but it is very
 * unlikely to get the *same* cell wrong every time. So we group the parsed
 * slots by subject and let the majority spelling fix the minority ones.
 *
 * It is a cheap, self-supervised cleanup that typically takes a photographed
 * timetable from "mostly right" to "just works" without any ML.
 */

const OCR_GLYPHS: Array<[RegExp, string]> = [
  [/[€©¢₵]/g, 'C'],
  [/[\u2018\u2019]/g, "'"],
];

export function sanitiseSubject(raw: string): string {
  let text = raw;
  for (const [pattern, replacement] of OCR_GLYPHS) text = text.replace(pattern, replacement);
  return text
    .replace(/\bIll\b/g, 'III')
    .replace(/\bll\b/g, 'II')
    .replace(/\b1l\b/g, 'II')
    .replace(/\b[0Oo][sS]\b/g, 'OS')
    .replace(/\b0(?=[A-Za-z]{2,}\b)/g, 'O')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function normaliseFaculty(raw: string): string {
  return raw
    // "Ms. N. lyer" — a lowercase l right after an initial is almost always I.
    .replace(/\b([A-Z])\.\s+l(?=[a-z])/g, '$1. I')
    .replace(/[€©¢]/g, 'C')
    .replace(/\s*[,;]\s*/g, '. ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+\./g, '')
    .trim();
}

/** Uppercase course code candidates and repair the usual digit/letter swaps. */
export function normaliseCode(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let code = raw.toUpperCase().replace(/[€©¢]/g, 'C').replace(/[^A-Z0-9]/g, '');
  const match = code.match(/^([A-Z]{1,5})(\d{2,4})([A-Z]?)$/);
  if (!match) return undefined;
  // "C5301" (S read as 5) → "CS301": only when the letter run is 1 char and the
  // digit run is 4 long, which is the shape of a misread dept prefix.
  if (match[1].length === 1 && match[2].length === 4 && /^[5]$/.test(match[2][0])) {
    code = `${match[1]}S${match[2].slice(1)}${match[3]}`;
  }
  return code;
}

/**
 * OCR-confusable characters. Two spellings are considered "the same value
 * misread" only when they have the same length and differ at a couple of
 * positions that belong to the same confusion group. That keeps
 * "LH-201" and "LH-204" — two genuinely different rooms — apart.
 */
const CONFUSABLE: string[][] = [
  ['l', 'I', 'i', '1', '|'],
  ['0', 'O', 'o', 'Q'],
  ['5', 'S', 's'],
  ['2', 'Z', 'z'],
  ['8', 'B'],
  ['6', 'G', 'b'],
  ['9', 'g', 'q'],
  ['c', 'C', 'e'],
  ['u', 'U', 'v', 'V'],
  ['n', 'N', 'h', 'H'],
  [',', '.'],
  ['rn', 'm'],
];

function sameFamily(a: string, b: string): boolean {
  return CONFUSABLE.some(
    (family) =>
      (family.includes(a) && family.includes(b)) ||
      (family.includes(a.toLowerCase()) && family.includes(b.toLowerCase())),
  );
}

function ocrSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      if (!sameFamily(a[i], b[i])) return false;
      diff++;
      if (diff > 2) return false;
    }
    return diff > 0;
  }
  // one extra/missing character that is confusable (e.g. "lyer" vs "Iyer"): only
  // accept when the strings are otherwise identical.
  const [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
  for (let i = 0; i < longer.length; i++) {
    const candidate = longer.slice(0, i) + longer.slice(i + 1);
    if (candidate.toLowerCase() === shorter.toLowerCase()) return true;
  }
  return false;
}

/**
 * Map every observed spelling to the most credible spelling of the same value.
 * Frequency wins; capitalisation breaks ties (OCR drops capitals more often
 * than it adds them).
 */
function buildVocabulary(values: Array<string | undefined>): Map<string, string> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const unique = [...counts.keys()];
  const score = (value: string) =>
    (counts.get(value) ?? 0) * 10 + (value.match(/[A-Z]/g)?.length ?? 0) * 0.5;

  const canonical = new Map<string, string>();
  for (const value of unique) {
    let best = value;
    for (const other of unique) {
      if (other === value) continue;
      if (!ocrSimilar(value, other)) continue;
      if (score(other) > score(best) + 0.01) best = other;
    }
    canonical.set(value, best);
  }
  return canonical;
}

function groupKey(subject: string, code?: string): string {
  let text = sanitiseSubject(subject).toLowerCase();
  // drop a leading garbled course code ("Cs301 data structures")
  const leadingCode = text.match(/^([a-z0-9]{2,8})\s+(.*)$/);
  if (leadingCode && /\d/.test(leadingCode[1]) && leadingCode[2].length > 2) {
    text = leadingCode[2];
  }
  if (code) text = text.replace(code.toLowerCase(), '');
  const compact = text.replace(/[^a-z]+/g, '');
  return compact.slice(0, 28) || text.replace(/[^a-z]+/g, '');
}

function mostCommon<T>(values: T[]): { value: T; count: number } | null {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: { value: T; count: number } | null = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

/**
 * Majority vote over faculty spellings, biased towards the variant with more
 * internal capitals — OCR reading "Iyer" as "lyer" loses exactly one capital.
 */
function voteFaculty(values: string[]): { value: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const scored = [...counts.entries()].map(([value, count]) => ({
    value,
    count,
    score: count * 10 + (value.match(/[A-Z]/g)?.length ?? 0),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0] ? { value: scored[0].value, count: scored[0].count } : null;
}

function canonicalSubject(subjects: string[]): string {
  const cleaned = subjects.map(sanitiseSubject).filter(Boolean);
  if (!cleaned.length) return '';
  const scored = cleaned.map((subject) => {
    const looksClean = !/[€©¢]/.test(subject) && subject === subject.replace(/\s+/g, ' ').trim();
    const frequent = cleaned.filter((s) => s.toLowerCase() === subject.toLowerCase()).length;
    const upper = subject.match(/[A-Z]/g)?.length ?? 0;
    return { subject, score: frequent * 10 + (looksClean ? 5 : 0) + upper * 0.3 + Math.min(subject.length, 30) * 0.1 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].subject;
}

export function reconcileEvents(events: ParsedEvent[]): ParsedEvent[] {
  const groups = new Map<string, ParsedEvent[]>();
  for (const event of events) {
    if (event.kind === 'break') continue;
    const key = groupKey(event.subject, event.code);
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const codes = group
      .map((e) => normaliseCode(e.code))
      .filter((c): c is string => Boolean(c));
    const codeVote = mostCommon(codes);

    const faculties = group.map((e) => e.faculty && normaliseFaculty(e.faculty)).filter(Boolean) as string[];
    const facultyVote = voteFaculty(faculties);

    const rooms = group.map((e) => e.room).filter(Boolean) as string[];
    const roomVote = mostCommon(rooms);

    const subject = canonicalSubject(group.map((e) => e.subject));

    for (const event of group) {
      if (subject) event.subject = subject;
      if (codeVote && codeVote.count >= Math.max(2, Math.ceil(group.length / 3))) {
        event.code = codeVote.value;
      } else if (event.code) {
        event.code = normaliseCode(event.code) ?? event.code;
      }
      if (facultyVote && facultyVote.count >= 2) event.faculty = facultyVote.value;
      else if (event.faculty) event.faculty = normaliseFaculty(event.faculty);
      if (roomVote && roomVote.count >= 2) event.room = roomVote.value;
    }
  }

  // Document-wide vocabulary pass: a teacher or room spelled correctly
  // somewhere else in the timetable fixes the one-off misreading here.
  const facultyCanon = buildVocabulary(events.map((e) => e.faculty));
  const roomCanon = buildVocabulary(events.map((e) => e.room));
  const subjectCanon = buildVocabulary(events.map((e) => e.subject));

  for (const event of events) {
    event.subject = subjectCanon.get(sanitiseSubject(event.subject)) ?? sanitiseSubject(event.subject);
    if (event.faculty) {
      const normalised = normaliseFaculty(event.faculty);
      event.faculty = facultyCanon.get(normalised) ?? normalised;
    }
    if (event.room) event.room = roomCanon.get(event.room) ?? event.room;
    if (event.code) event.code = normaliseCode(event.code) ?? event.code;
  }

  return events;
}
