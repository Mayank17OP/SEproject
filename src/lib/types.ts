/**
 * Shared types for the timetable → calendar pipeline.
 *
 * Everything the parser sees is normalised into `Page`, whether it came from a
 * PDF text layer or from OCR. That is the key design decision: one parser,
 * many extractors.
 */

/** A single word/token with a bounding box in page coordinates (origin top-left, y grows down). */
export interface Word {
  text: string;
  /** left edge, in CSS pixels of the rendered page (or OCR image pixels) */
  x: number;
  /** top edge */
  y: number;
  /** width */
  w: number;
  /** height */
  h: number;
  /** 0..100, only present for OCR sources */
  conf?: number;
}

/** Words that share a baseline, ordered left → right. */
export interface Line {
  words: Word[];
  text: string;
  x: number;
  y: number;
  h: number;
  /** mean word confidence, 0..100, OCR only */
  conf?: number;
}

export interface Page {
  index: number;
  width: number;
  height: number;
  lines: Line[];
}

export type SourceKind = 'pdf-text' | 'pdf-ocr' | 'image-ocr';

export interface SourceInfo {
  kind: SourceKind;
  fileName: string;
  pages: number;
  /** characters recoverable from the PDF text layer (0 for OCR sources) */
  textChars: number;
  /** mean OCR confidence 0..100 when OCR was used */
  ocrConfidence?: number;
  /** ms spent extracting */
  extractMs?: number;
}

export type EventKind = 'class' | 'lab' | 'break';

/** One recurring weekly slot. */
export interface ParsedEvent {
  id: string;
  /** 0 = Sunday … 6 = Saturday (matches JS Date.getDay and ICS BYDAY) */
  day: number;
  /** "HH:MM", 24h, local wall-clock time in the target timezone */
  start: string;
  /** "HH:MM" */
  end: string;
  subject: string;
  /** course code such as CS301, when detected */
  code?: string;
  room?: string;
  faculty?: string;
  kind: EventKind;
  /** the raw text the cell was parsed from — shown in the review UI */
  raw?: string;
  /** 0..1 */
  confidence: number;
}

export interface ParseWarning {
  code:
    | 'no-events'
    | 'no-day-header'
    | 'missing-time'
    | 'partial-cell'
    | 'low-ocr-confidence'
    | 'text-layer-missing'
    | 'multiple-pages'
    | 'empty-cell'
    | 'fallback-parser';
  message: string;
  page?: number;
}

export interface ParseMeta {
  /** how the table layout was detected */
  layout: 'days-as-rows' | 'days-as-columns' | 'line-list' | 'none';
  cellsParsed: number;
  cellsEmpty: number;
  /** pages that were joined because the timetable spanned more than one page */
  pagesUsed: number;
}

export interface ParseResult {
  events: ParsedEvent[];
  warnings: ParseWarning[];
  meta: ParseMeta;
  source: SourceInfo;
}

/* ------------------------------------------------------------------ */
/* ICS export options                                                  */
/* ------------------------------------------------------------------ */

export interface ExportOptions {
  calendarName: string;
  /** IANA timezone, e.g. "Asia/Kolkata" */
  timeZone: string;
  /** first day the classes repeat, "YYYY-MM-DD" */
  startDate: string;
  /** last day the classes repeat (inclusive), "YYYY-MM-DD" */
  endDate: string;
  /** ISO dates "YYYY-MM-DD" that should be skipped (holidays) */
  holidays: string[];
  /** minutes before class for the reminder; 0 disables the alarm */
  reminderMinutes: number;
  /** include room in LOCATION (default true) */
  includeLocation: boolean;
  /** include faculty in DESCRIPTION (default true) */
  includeFaculty: boolean;
  /** skip break/lunch slots */
  skipBreaks: boolean;
}
