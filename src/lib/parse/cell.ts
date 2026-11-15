import type { EventKind, ParsedEvent } from '../types';
import { normaliseText } from '../text';

/**
 * Cell text → { subject, code, room, faculty }.
 *
 * Real timetables drop the subject, the room and the teacher into one cell in no
 * particular order, separated by newlines, slashes, commas or nothing at all:
 *
 *   "CS301                |  Data Structures  |  DS / LH-204 / Dr. A. Kumar
 *    Data Structures      |  Room 204         |  DS Lab  204  Prof. S. Rao
 *    LH-204               |  Dr. Sharma       |  Mathematics-II / B-201 / Ms. Nair
 *    Dr. A. Kumar"
 *
 * Strategy: labelled fields first (highest confidence), then pattern
 * classification per segment, then "whatever is left is the subject".
 */

const ROOM_LABELLED =
  /\b(?:room|rm|venue|class\s*room|lecture\s*hall|hall|lt|block|floor)\b\s*(?:no\.?|number|#|:|-)?\s*([A-Z]{0,4}\s?[-/]?\s?\d{1,4}[A-Z]?)\b/i;

/** "Lab-2", "Lab 4", "Laboratory 3" — the keyword must touch the number. */
const ROOM_LAB =
  /\blab(?:oratory)?\b\s*(?:no\.?|number|#|:|-)?\s*(\d{1,4}[A-Z]?)\b/i;

/** A room-shaped token: "LH-204", "B-12", "Lab-2", "CS/204". */
const ROOM_CODE =
  /\b(?:lab|lh|lt|hall|block|room)?\s?([A-Z]{1,4}\s?[-/]\s?\d{1,3}[A-Z]?|[A-Z]{2,4}\d{2,4})\b/;

const ROOM_KEYWORD = ROOM_LABELLED;

/** Standalone room-ish token: "LH-204", "B-12", "204", "Lab-3". */
const ROOM_TOKEN = /^(?:room\s*)?([A-Z]{1,4}\s?[-/]\s?\d{1,3}[A-Z]?|\d{3,4}[A-Z]?)$/i;
const TRAILING_ROOM = /(?:^|\s)([A-Z]{1,4}\s?[-/]\s?\d{1,3}[A-Z]?|\d{3,4})\s*$/i;

const FACULTY_KEYWORD =
  /\b(?:faculty|teacher|prof(?:essor)?|instructor|taught\s*by)\b\s*[:.\-]?\s*((?:Dr|Prof|Mr|Mrs|Ms|Shri|Smt|Er)\.?\s+)?([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3})/;

const HONORIFIC = /\b(?:Dr|Prof|Mrs?|Ms|Shri|Smt|Er)\.?\s*[A-Z0-9][A-Za-z.'-]*(?:[,.]?\s+[A-Z0-9][A-Za-z.'-]*){0,3}/;

const NAME_LIKE = /^[A-Z][a-z]+(?:\s+[A-Z]\.?)*(?:\s+[A-Z][a-z]+)+$/;

const CODE_LIKE = /^([A-Za-z]{2,5})\s?[-_]?\s?(\d{2,4})([A-Za-z]?)(?:\b|$)\s*(.*)$/;

const BREAK_WORDS = /\b(?:lunch|break|recess|interval|free|vacant|no\s+class|nil|tea|period)\b/i;

const LAB_WORDS = /\b(?:lab|laboratory|practical|workshop|tutorial|studio)\b/i;

const STOPWORDS = new Set([
  'THE', 'AND', 'OF', 'FOR', 'TO', 'IN', 'ON', 'AT', 'AN', 'A', 'ROOM', 'LAB', 'CLASS',
  'HALL', 'BLOCK', 'FLOOR', 'SEM', 'SEMESTER', 'BATCH', 'GROUP', 'ALL', 'TBD', 'TBA',
  'DAY', 'TIME', 'PERIOD', 'FREE',
]);

export interface CellFields {
  subject: string;
  code?: string;
  room?: string;
  faculty?: string;
  kind: EventKind;
  /** 0..1 — how sure we are the cell was interpreted correctly */
  confidence: number;
}

function cleanup(value: string): string {
  return normaliseText(value)
    .replace(/^[\s:;,./|-]+|[\s:;,./|-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function looksLikeName(value: string): boolean {
  const v = cleanup(value);
  if (!v || v.length > 40 || /\d/.test(v)) return false;
  if (NAME_LIKE.test(v)) return true;
  const words = v.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  const capitalised = words.filter((w) => /^[A-Z][a-z]/.test(w) || /^[A-Z]\.?$/.test(w)).length;
  if (capitalised < words.length) return false;
  return !words.some((w) => STOPWORDS.has(w.toUpperCase()));
}

/** Split a cell into segments on newlines and the separators people use. */
export function splitSegments(text: string): string[] {
  const segments: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const parts = rawLine.split(/\s*(?:\/|\||·|•|;)\s*|\s+-\s+|\s{3,}/);
    for (const part of parts) {
      const seg = cleanup(part);
      if (seg) segments.push(seg);
    }
  }
  return segments;
}

interface RoomHit {
  room: string;
  matched: string;
}

/** Find the most room-like token in a segment (labelled patterns first). */
function findRoomLabel(text: string): RoomHit | null {
  const labelled = [...text.matchAll(new RegExp(ROOM_LABELLED.source, 'gi'))].pop();
  if (labelled) return { room: cleanup(labelled[1]), matched: labelled[0] };

  const lab = [...text.matchAll(new RegExp(ROOM_LAB.source, 'gi'))].pop();
  if (lab) {
    const keyword = (lab[0].match(/^(lab(?:oratory)?)/i)?.[0] ?? 'Lab').replace(/oratory$/i, '');
    return { room: `${keyword.charAt(0).toUpperCase()}${keyword.slice(1).toLowerCase()}-${cleanup(lab[1])}`, matched: lab[0] };
  }

  const code = [...text.matchAll(new RegExp(ROOM_CODE.source, 'gi'))].pop();
  if (code) {
    const token = cleanup(code[1]);
    // Only trust a separator form ("LH-204") here; bare numbers are handled later.
    if (/[A-Za-z]/.test(token) && /[-/]/.test(token)) return { room: token, matched: code[0] };
  }
  return null;
}

interface State {
  room?: string;
  faculty?: string;
  code?: string;
  subjects: string[];
}

/**
 * Take one segment apart. Mutates and returns the shared state.
 * `subjects` collects subject-ish text; the first non-empty entry usually wins.
 */
function classifySegment(rawSeg: string, state: State): void {
  let work = cleanup(rawSeg);
  if (!work) return;

  // 1. Explicit "Room 204" / "Lab-3" style labels (the LAST match wins, because
  //    rooms are written after the subject: "DBMS Lab ... Lab-1").
  if (!state.room) {
    const found = findRoomLabel(work);
    if (found) {
      state.room = found.room;
      work = cleanup(work.replace(found.matched, ' '));
      if (!work) return;
    }
  }

  // 2. Explicit "Faculty: ..." label.
  const facultyKw = work.match(FACULTY_KEYWORD);
  if (facultyKw && !state.faculty) {
    const name = cleanup(`${facultyKw[1] ?? ''}${facultyKw[2] ?? ''}`);
    if (name.split(/\s+/).length >= 2) {
      state.faculty = name;
      work = cleanup(work.replace(facultyKw[0], ' '));
      if (!work) return;
    }
  }

  // 3. An honorific anywhere in the segment.
  const honour = work.match(HONORIFIC);
  if (honour && honour.index !== undefined && !state.faculty) {
    const tail = cleanup(work.slice(honour.index));
    const head = cleanup(work.slice(0, honour.index));
    if (tail.split(/\s+/).length >= 2) {
      state.faculty = tail;
      work = head;
      if (!work) return;
    }
  }

  // 4. A course code, usually the first token: "CS301 Data Structures".
  const codeMatch = work.match(CODE_LIKE);
  if (codeMatch && !state.code && !/^\d+$/.test(codeMatch[1])) {
    // "LH-204" also matches a loose code pattern in some spellings; only accept
    // when the numeric part is a plausible course number (100-999).
    const looksLikeRoom = /^(?:room|lab|lt|hall|block|floor)/i.test(work) ||
      new RegExp(`^[A-Z]{1,3}\\s?[-/]\\s?${codeMatch[2]}$`, 'i').test(work.split(/\s+/)[0]);
    if (!looksLikeRoom) {
      state.code = `${codeMatch[1]}${codeMatch[2]}${codeMatch[3] ?? ''}`.toUpperCase();
      work = cleanup(codeMatch[4] ?? '');
      if (!work) return;
    }
  }

  // 5. A standalone room token: "LH-204", "204", "Lab-2".
  if (!state.room) {
    const tokenMatch = work.match(ROOM_TOKEN);
    if (tokenMatch) {
      state.room = cleanup(tokenMatch[1]);
      return;
    }
  }

  // 6. A trailing room token after the subject name: "Data Structures Lab-2".
  if (!state.room) {
    const trailing = work.match(TRAILING_ROOM);
    if (trailing && work.length > trailing[1].length + 2) {
      state.room = cleanup(trailing[1]);
      work = cleanup(work.slice(0, trailing.index));
      if (!work) return;
    }
  }

  // 7. A name with no honorific only counts as a teacher when we already have
  //    something subject-like, otherwise it is the subject itself.
  if (!state.faculty && state.subjects.length > 0 && looksLikeName(work)) {
    state.faculty = work;
    return;
  }

  if (work) state.subjects.push(work);
}

/**
 * Parse a timetable cell.
 * @param raw cell text (the grid parser joins cell lines with "\n")
 */
export function parseCell(raw: string): CellFields {
  const text = raw.trim();
  if (!text) return { subject: '', kind: 'class', confidence: 0 };

  const flat = normaliseText(text);

  if (BREAK_WORDS.test(flat) && flat.length < 40 && !/[A-Z]{2}\d{2,4}/.test(flat)) {
    return { subject: cleanup(flat), kind: 'break', confidence: 0.9 };
  }

  const state: State = { subjects: [] };
  for (const segment of splitSegments(text)) classifySegment(segment, state);

  let { room, faculty, code } = state;
  const subjects = [...new Set(state.subjects.map(cleanup).filter(Boolean))];

  // A cell that is *only* a teacher name is better used as the class name.
  let subject = cleanup(subjects.join(' / '));
  if (!subject && faculty) {
    subject = faculty;
    faculty = undefined;
  }
  if (!subject) subject = cleanup(flat.replace(room ?? '', '').replace(faculty ?? '', ''));
  if (!subject) subject = cleanup(flat) || 'Class';

  // Pull a leading course code that survived inside the subject text.
  if (!code) {
    const leading = subject.match(CODE_LIKE);
    if (leading && leading[4] && leading[4].length > 2) {
      code = `${leading[1]}${leading[2]}${leading[3] ?? ''}`.toUpperCase();
      subject = cleanup(leading[4]);
    }
  }

  const kind: EventKind = LAB_WORDS.test(flat) ? 'lab' : 'class';

  let confidence = 0.55;
  if (subject && subject !== 'Class') confidence += 0.15;
  if (room) confidence += 0.1;
  if (faculty) confidence += 0.1;
  if (code) confidence += 0.05;
  confidence = Math.min(0.98, confidence);

  return { subject, code, room, faculty, kind, confidence };
}

/** Same slot appearing twice (e.g. duplicated across pages)? */
export function eventKey(event: Pick<ParsedEvent, 'day' | 'start' | 'subject' | 'room'>): string {
  return `${event.day}|${event.start}|${event.subject.toLowerCase()}|${(event.room ?? '').toLowerCase()}`;
}

export const cellHelpers = { looksLikeName, splitSegments, cleanup };
