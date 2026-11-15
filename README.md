# Timetable → Calendar

Upload a college timetable **PDF or photo** → get an `.ics` file where every class repeats weekly with the **room**, the **teacher** and a **reminder**, ready for Google Calendar, Apple Calendar or Outlook.

No accounts. No database. No third-party OCR API. One server request, then the file is gone.

```
┌──────────────┐   ┌──────────────────────────────┐   ┌────────────────────┐
│ timetable.pdf│ → │ pdf.js text layer  ──┐       │ → │ review + edit      │ → calendar.ics
│ notice.jpg   │   │ sharp + tesseract ───┤ Page  │   │ week grid, warnings│   (RFC 5545)
└──────────────┘   └──────────────────────┴───────┘   └────────────────────┘
```

---

## Quick start

```bash
npm install          # also vendors the OCR model + WASM core into ./vendor (postinstall)
npm run dev          # http://localhost:3000
```

Production:

```bash
npm run build && npm start
```

Tests:

```bash
npm test             # 58 tests: time parsing, cell parsing, 4 layouts, ICS round-trip, real PDF + real OCR
npm run typecheck
```

Regenerate the demo files in `public/samples/` with `npm run samples`.

### Requirements

- Node 20+ (developed on 22)
- No system packages: OCR runs on `tesseract.js` + bundled WASM, PDF rasterising uses `@napi-rs/canvas`, image work uses `sharp`. Nothing to `apt-get install`, which is exactly why this deploys cleanly to Vercel.

---

## How it works

### 1. Extraction — three inputs, one internal format

| Input | Path |
| --- | --- |
| Digital PDF | `pdfjs-dist` text layer with `Util.transform` → word boxes in page space |
| Scanned PDF | page rasterised at 2× with `@napi-rs/canvas`, then OCR (max 3 pages) |
| Photo / screenshot | `sharp` preprocessing → `tesseract.js` |

A page with fewer than 60 characters of text is treated as a scan and goes to OCR automatically.

OCR preprocessing runs two variants — grayscale + normalise + sharpen, and the same with a threshold — and keeps whichever scores better on confidence × text length. The worker is a module-level singleton and jobs are serialised, so a warm instance pays the ~600 ms spawn cost once.

Everything becomes `Page { lines: Line { words: Word { x, y, w, h, conf } } }`, so the parser is written once (`src/lib/parse/`).

### 2. Layout detection

Four strategies, tried in order of confidence:

1. **Days as rows** — weekday labels down the first column, times across the top.
2. **Days as columns** — the transposed layout.
3. **Period grid + legend** — `P1…P8` headers resolved against a `P1 9:00–9:55` legend line.
4. **Line list** — free-form `MON 9:00-10:00 DS Room 204 Dr Rao` lines.

Orientation is decided by counting *distinct weekday names* sharing a y-cluster (header row) versus an x-cluster (left column).

The interesting part is **row bands**. Day labels sit at the top of a row in most timetables, but some layouts centre them. Midpoint boundaries therefore shift every row by half a cell, which is how the teacher's name ends up in the next day's event. Instead, content y-positions are folded into one row period; the largest circular gap is the space between rows, and boundaries are placed just after it. That single trick handles both alignments (`estimateBands` in `src/lib/parse/grid.ts`).

### 3. Cell → event

```
CS301                →  code:    CS301
Data Structures      →  subject: Data Structures
LH-204               →  room:    LH-204
Dr. A. Kumar         →  faculty: Dr. A. Kumar
```

Labeled fields first (`Room:`, `Faculty:`), then token classification (room-shaped, honourific-shaped, code-shaped), then “the rest is the subject”. Nothing is invented — a missing room stays missing and raises a warning instead.

### 4. Self-correction

A timetable repeats the same 6 subjects all week, which is free supervision:

- **Glyph repair in context** — `€s301` → `CS301`, `M0N` → `MON`, `Engineering Maths ll` → `II`, `0s Lab` → `OS Lab`.
- **Majority vote per subject group** — the most common code / room / faculty spelling wins for the whole document.
- **Document vocabulary** — a name spelled correctly once fixes a one-off misread (`Ms. N. lyer` → `Ms. N. Iyer`), but only when the difference is a known OCR confusion, so `LH-201` and `LH-204` are never merged.

On the bundled photo sample this takes the raw OCR output (`€S355`, `Prof. 5. Rao`, `Ms. N. lyer`) to a clean 34-slot timetable with correct rooms, codes and teachers.

### 5. Calendar generation

`src/lib/ics.ts` + `src/lib/tz.ts`, RFC 5545, no `icalendar`/`ics` dependency:

- **VTIMEZONE per calendar**, with real observances computed from `Intl` (fixed offset for `Asia/Kolkata`; `STANDARD`/`DAYLIGHT` transition pairs for DST zones, e.g. New York 2026-03-08 and 2026-11-01).
- `DTSTART;TZID=Asia/Kolkata:20260105T090000` — wall-clock anchored, so 9 AM stays 9 AM even if DST moves around it.
- `RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260424T182959Z` — `UNTIL` is UTC as the RFC requires when `DTSTART` is a `TZID` value.
- `EXDATE` for holidays, only on dates where the class would actually have occurred.
- `VALARM` reminder, `LOCATION` = room, `DESCRIPTION` = course/code/teacher/room/type.
- CRLF line endings, 75-**octet** folding (bytes, not characters), TEXT escaping, stable `UID`s so re-importing updates instead of duplicating.

Verified in tests by parsing the output back with `node-ical`.

---

## API

### `POST /api/parse`

`multipart/form-data`, field `file` (≤ 12 MB).

```json
{
  "events": [
    {
      "id": "1-09:00-950-abc12",
      "day": 1, "start": "09:00", "end": "09:55",
      "subject": "Data Structures", "code": "CS301",
      "room": "LH-204", "faculty": "Dr. A. Kumar",
      "kind": "class", "confidence": 0.95,
      "raw": "CS301 Data Structures LH-204 Dr. A. Kumar"
    }
  ],
  "warnings": [{ "code": "partial-cell", "message": "…", "page": 0 }],
  "meta": { "layout": "days-as-rows", "cellsParsed": 34, "cellsEmpty": 2, "pagesUsed": 1 },
  "source": { "kind": "pdf-text", "fileName": "cse-sem3.pdf", "pages": 1, "textChars": 1173, "extractMs": 170 },
  "fileMeta": { "name": "cse-sem3.pdf", "size": 5821, "isPdf": true },
  "elapsedMs": 208
}
```

`day` is `0 = Sunday … 6 = Saturday` (matches `Date.getDay()` and ICS `BYDAY`).

### `POST /api/ics`

```json
{ "events": [ /* as above */ ],
  "options": { "calendarName": "CSE Sem 3", "timeZone": "Asia/Kolkata",
               "startDate": "2026-01-05", "endDate": "2026-04-24",
               "holidays": ["2026-01-26"], "reminderMinutes": 10,
               "includeLocation": true, "includeFaculty": true, "skipBreaks": true } }
```

Returns `text/calendar` as an attachment. `400` with a readable message for invalid dates or an unknown timezone.

### `GET /api/health`

```json
{ "ok": true, "ocr": { "model": true, "core": true, "modelBytes": 2952873 }, "runtime": "v22.22.3" }
```

---

## Deploy

### Vercel (zero config)

```bash
npm i -g vercel && vercel        # or import the repo at vercel.com/new
```

`postinstall` vendors the OCR model and WASM core, and `next.config.ts` includes `./vendor/**` in the `/api/parse` function bundle via `outputFileTracingIncludes`. `maxDuration` is already 120 s on that route.

### Docker

```bash
docker build -t timetable-calendar .
docker run -p 3000:3000 timetable-calendar
```

### Any Node host

```bash
npm ci && npm run build && npm start   # binds 0.0.0.0:3000
```

### Notes for hosts

- The first OCR request on a cold instance takes ~8–12 s (WASM + model initialisation). Subsequent ones are ~4–5 s. Digital PDFs never touch OCR (< 0.3 s).
- `.next`, `node_modules` and `vendor` are build artefacts; `vendor` is regenerated by `postinstall`.

---

## Configuration

Nothing is required. Optional tweaks live in `src/lib`:

| What | Where |
| --- | --- |
| Upload cap (12 MB), OCR page cap (3) | `src/app/api/parse/route.ts` |
| OCR target width (2000 px), PSM, confidence floor | `src/lib/ocr.ts` |
| Time column / band heuristics | `src/lib/parse/grid.ts` |
| Reminder presets, timezone list | `src/lib/tz.ts`, `src/components/SettingsPanel.tsx` |
| Default term length (16 weeks) | `src/components/App.tsx` |

---

## Project structure

```
src/
├─ app/
│  ├─ page.tsx                 # renders <App/>
│  ├─ layout.tsx, globals.css  # metadata, Tailwind theme, design tokens
│  └─ api/
│     ├─ parse/route.ts        # upload → extract → parse → JSON
│     ├─ ics/route.ts          # events + options → .ics download
│     └─ health/route.ts       # deployment smoke test
├─ components/                 # client UI (uploader, week grid, editor, settings, export)
└─ lib/
   ├─ types.ts                 # shared model (Word/Line/Page/Event/Options)
   ├─ text.ts                  # word→line grouping, normalisation
   ├─ time.ts                  # time ranges, day tokens, 12h/24h
   ├─ dates.ts, csv.ts         # term helpers, CSV export
   ├─ pdf.ts                   # pdf.js text layer + page rasterising
   ├─ ocr.ts                   # sharp preprocessing + tesseract worker
   ├─ parse/
   │  ├─ index.ts              # multi-page parse, dedupe, warnings
   │  ├─ grid.ts               # 4 layout strategies + band estimation
   │  ├─ cell.ts               # subject / room / faculty / code heuristics
   │  └─ reconcile.ts          # OCR glyph repair + cross-cell voting
   ├─ ics.ts                   # RFC 5545 writer
   └─ tz.ts                    # Intl-based offsets, transitions, VTIMEZONE
scripts/
├─ vendor-assets.mjs           # postinstall: OCR model + WASM → vendor/
└─ make-samples.mjs            # generates the demo PDFs / photo / scanned PDF
tests/                         # vitest: unit + real-file pipeline tests
```

---

## Known limitations

- **Merged cells.** A two-period lab printed as one merged cell is read as one event of the first period; extend the end time in the editor (two taps).
- **Photos with heavy perspective distortion** (not just rotation) lose column alignment. Straight on is better; screenshots and scans are perfect.
- **English only** in the UI defaults (the OCR loader accepts other traineddata, the day/time vocabulary does not).
- **Non-Gregorian or week-letter timetables** (“Day 1/Day 2” rotation, week A/B) are not modelled.
- Timetables with **no weekday labels at all** fall back to line parsing and usually need manual entry.

## License

MIT — see [`LICENSE`](LICENSE). Product thinking in [`PRD.md`](PRD.md).
