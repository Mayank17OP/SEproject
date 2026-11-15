# PRD — Timetable → Calendar

**Working title:** Timetable → Calendar (`timetable-to-calendar`)
**Type:** Student utility, single-purpose web app
**Author:** Mayank Dubey
**Status:** v1.0 — shipped, deployed, fully functional
**Last updated:** 15 November 2026

---

## 1. The problem

Every semester, every student in India receives a timetable as one of four things:

1. A PDF from the department portal (often a Word export, sometimes a photo pasted into a PDF).
2. A printed sheet on the notice board.
3. A photo forward on the class WhatsApp group, usually cropped at an angle with a thumb in the corner.
4. A screenshot of a spreadsheet.

That timetable then lives in the wrong place. Classes are **recurring weekly events with a room and a teacher** — the exact shape a calendar wants — yet students retype 30 rows into Google Calendar by hand, or (more commonly) don't, and then miss labs.

Existing workarounds all fail in a specific, explainable way:

| Workaround | Why it fails |
| --- | --- |
| Retype into Google Calendar | ~20–30 minutes, off-by-one-hour mistakes, no room/teacher, breaks after the first week |
| Photo in gallery / pinned chat | Not searchable, not time-aware, no reminders |
| College ERP / app | Usually no calendar export; if it exports, it's .xls nobody can import |
| Generic “AI extract” tools | Upload to a third-party server, paywall the download, lose the room/teacher distinction |

**The gap:** a 30-second path from “the department's ugly PDF” to “my phone buzzes 10 minutes before DBMS in LH-201.”

---

## 2. Users

### Primary persona — “Week-one Aarav”
Second/third-year B.Tech student, 6 subjects + 3 labs, Android phone, Google Calendar, moderate technical confidence. Wants the timetable in his phone before the first lecture. Will share a tool with the class WhatsApp group if it works on the first try.

Success for Aarav = he photographs the notice board and has a working calendar in under a minute, with the right rooms, without typing anything except his term dates.

### Secondary persona — “Class rep Meera”
Maintains the class timetable. Gets asked “what's the room for OS lab?” 40 times a week. Wants to distribute one file that everyone can import, and re-share it when a room changes.

### Tertiary persona — “Hostel Wi-Fi Rohan”
On a slow, unreliable connection and a low-end phone. Cannot install an app; needs a web page that works on 3G with a 2 MB photo.

---

## 3. Goals, non-goals, principles

### Goals
- **G1** — Convert a timetable photo/PDF into a valid `.ics` with **zero typing** for the common case.
- **G2** — Preserve the three things students actually need at 8:55 AM: **subject, room, teacher**.
- **G3** — Produce a calendar that behaves correctly for a whole semester: weekly recurrence, real timezones, holidays, reminders, no duplicates on re-import.
- **G4** — Make failure legible: if a cell is unreadable, say which one instead of silently dropping it.
- **G5** — Be deployable by a student on free infrastructure, with no API keys and no paid OCR service.

### Non-goals (v1)
- No accounts, logins, cloud sync or multi-device state.
- No live sync with the college ERP or automatic re-import on timetable change.
- No editing of events *inside* an external calendar (we hand off a file, we don't own the calendar).
- No attendance tracking, no class reminders beyond a standard VALARM, no social features.
- No non-English OCR (v1 is `eng` only; the architecture accepts more traineddata).
- No mobile app. The web app is installable-feeling but is a website.

### Principles
- **Nothing is stored.** The uploaded file is parsed in memory and discarded. This is a distribution feature: a class rep can share the link without a privacy argument.
- **The parsed result is a draft, never a verdict.** The review screen exists because a wrong reminder is worse than no reminder.
- **Every guess is visible.** Confidence and warnings are surfaced, not swallowed.

---

## 4. Core user journey

```
Open link
  → Drop PDF / take photo / pick a sample
  → [reading 3–10 s: text layer or OCR, grid detection, reconciliation]
  → Review: week grid + editable rows + warnings + confidence
  → Term: start date, end date, timezone, reminder, holidays
  → Download .ics  (or copy ICS text, or open Google Calendar import)
  → Import → done
```

**Target:** under 60 seconds from landing to `.ics` on a phone, for a clean PDF.
**Measured:** 0.08–0.3 s for digital PDFs, 5–10 s for a photo or scanned PDF (single server request).

### Edge states that are designed, not accidental
- File is a scan → OCR branch, with an explicit progress screen naming the OCR step.
- File is a transposed timetable (days across the top) → same review UI, layout detected automatically.
- File has period numbers (`P1…P8`) and a legend → legend resolved into times.
- OCR is unsure about one cell → that row shows “Low confidence read — double-check this one”, plus an aggregate warning.
- No grid detected at all → line-by-line fallback, with a warning that says so.
- Nothing readable → empty state that says what to try instead (sharper photo, original PDF), and manual add still works.
- Semester dates wrong → validation error before export, not a broken calendar.

---

## 5. Functional requirements

### FR-1 Input
- Accept `.pdf`, `.png`, `.jpg/.jpeg`, `.webp`, `.bmp`, `.tif/.tiff`.
- Accept drag & drop, file picker, native camera capture (`capture="environment"`), and sample files.
- Reject other types and files > 12 MB with a human explanation.
- Detect PDF by magic bytes, not just extension.

### FR-2 Text extraction (PDF)
- Extract the text layer with coordinates via pdf.js.
- If a page yields < 60 characters, treat it as scanned: rasterise at 2× and OCR it, up to 3 pages.

### FR-3 OCR (images and scanned PDFs)
- Auto-orient (EXIF), grayscale, normalise, sharpen, upscale to ~2000 px wide.
- Run two pre-processing variants and keep whichever the OCR engine scores better.
- Use a bundled `eng` LSTM model (no network fetch at runtime), PSM 6, word bounding boxes preserved.
- Serialise jobs through one reusable worker (avoids the ~600 ms spawn cost per request).

### FR-4 Layout detection
Support, in this priority order:
1. **Days as rows** — weekday labels in the first column, times across the top.
2. **Days as columns** — weekday labels across the top, times down the left.
3. **Period grid + legend** — `P1…P8` headers with `P1 9:00–9:55` in a legend row.
4. **Line list** — free-form `MON 9:00-10:00 DS Room 204 Dr Rao` lines, one per class.
5. **None** — explicit failure, with the manual editor still available.

Row bands are computed by folding content positions into one row period and finding the largest circular gap, which handles both top-aligned and centre-aligned labels. Column boundaries come from header cell centres; the time column's right edge is derived from actual time-label positions.

### FR-5 Cell semantics
- Split cell text on newlines, `/`, `|`, `;`, `·` and wide gaps.
- Detect **rooms** (`Room 305`, `LH-204`, `B-12`, `Lab-3`, bare `204`).
- Detect **faculty** (`Dr. A. Kumar`, `Prof. S. Rao`, `Ms. N. Iyer`, `Faculty: …`, honourific-less names after a subject).
- Detect **course codes** (`CS301`, `MA-201`) and separate them from the subject.
- Detect **breaks** (`LUNCH`, `BREAK`, `FREE PERIOD`, `RECESS`) as a distinct event kind.
- Never invent a field: a missing room stays missing and raises a warning.

### FR-6 Self-correction
- Repair OCR glyph confusions in context (`€s301` → `CS301`, `M0N` → `MON`, `ll` → `II`, `0s` → `OS`).
- Cross-cell reconciliation: group slots by subject, then vote on the code, room and faculty spelling for the whole document.
- Document-wide vocabulary: a teacher spelled correctly once fixes cryptic one-off reads (`Ms. N. lyer` → `Ms. N. Iyer`), but only when the difference is a known OCR confusion — `LH-201` and `LH-204` must never be merged.

### FR-7 Review & editing
- Week-grid preview with per-subject colours.
- Editable rows: day, start, end, subject, room, faculty; delete and add.
- Low-confidence rows flagged inline.
- Warnings listed with counts, collapsible.

### FR-8 Export
- `.ics` (RFC 5545) with: `VTIMEZONE` for the chosen zone, `DTSTART;TZID`, weekly `RRULE` with a UTC `UNTIL`, `EXDATE` for holidays, `VALARM`, `LOCATION`, `DESCRIPTION` (subject, code, faculty, room, type), stable `UID`, CRLF endings, 75-octet folding, correct TEXT escaping.
- `.csv` for spreadsheets and printing.
- Copy ICS text to clipboard.
- Deep link to Google Calendar's import page.
- Term validation (end ≥ start, ≤ 370 days, valid dates, reminder 0–1440 min).

### FR-9 Deployment & operations
- Single `POST /api/parse` (multipart) and `POST /api/ics` (JSON).
- `GET /api/health` reports runtime, OCR model presence and uptime.
- No database, no environment secrets, no third-party API keys.
- One-command local run and one-click Vercel deploy; Dockerfile included.

---

## 6. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Performance | Digital PDF < 1 s. Photo < 12 s at 2000 px. Server response capped by a 12 MB upload limit. |
| Reliability | Photo path must tolerate ~1° skew, JPEG q60, phone lighting; any single unreadable cell must not fail the request. |
| Privacy | File processed in memory, never persisted; no logging of file contents; no analytics on parsed data. |
| Accessibility | Keyboard-operable upload zone, labelled inputs, visible focus rings, colour never the only signal (text labels accompany colours). |
| Mobile | Single-column review on ≤ 640 px, 44 px touch targets for primary actions, horizontal scroll confined to the week grid. |
| Compatibility | Modern evergreen browsers; Google Calendar, Apple Calendar, Outlook and Fastmail on the ICS side. |
| Correctness | ICS must round-trip through a real iCalendar parser (verified in tests with `node-ical`). |
| Maintainability | Parser is pure, framework-free TypeScript with unit tests per heuristic; UI never re-implements parsing. |

---

## 7. Success metrics

**Activation (the only one that matters at launch)**
- ≥ 70 % of uploads that produce ≥ 5 classes end in a downloaded `.ics`.
- Median time-to-download < 90 s for photos, < 30 s for PDFs.

**Quality**
- On a fixture set of 20 real timetables: ≥ 90 % of cells have correct subject, ≥ 85 % correct room, ≥ 85 % correct faculty.
- Zero malformed-calendar reports (validated by round-trip parsing).
- Warnings precision: no warning for a correctly parsed clean PDF.

**Distribution**
- One share per ~8 unique visitors (class groups are dense; the tool should travel through them).
- ≥ 25 % of visits from a mobile user agent, ≥ 15 % of uploads are photos rather than PDFs.

**Instrumentation plan (deliberately minimal)**
Count-only events — visits, uploads by kind, parse success/failure, downloads. No file contents, no filenames, no parsed text. Could be turned off entirely without degrading the product.

---

## 8. Technical approach (summary)

```
PDF ──► pdf.js text layer ──┐                    ┌─► grid parser ─► cells ─► reconcile ─► events
  └──(no text)──► raster ──►┤► Page(lines,words) ┤                                   │
Photo ──► sharp preprocess ─► tesseract OCR ─────┘                                   ▼
                                                                    review UI ◄── warnings/confidence
                                                                        │
                                                     /api/ics ◄─────────┘  → .ics (RFC 5545)
```

- **One parser, three extractors.** Both PDF text and OCR normalise into `Page → Line → Word`, so layout logic exists once.
- **Geometry over guesswork.** Column bands from header centres; row bands from content phase; time column edge from label positions.
- **Self-supervision beats a bigger model.** Majority voting across ~30 cells fixes most OCR misses for free.
- **Timezone correctness** is computed from `Intl` at request time, generating real `VTIMEZONE` observances — no bundled tz database and no DST drift.

Full details: [`README.md`](README.md) → Architecture, and the parser/writer source in `src/lib/`.

---

## 9. Risks & mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Wildly different college formats | Parser misses → empty result | Four layout strategies + line fallback + manual editor; every failure has a message with a next step. |
| OCR quality on bad photos | Wrong rooms | Deskew-ish preprocessing (auto-orient, normalise, upscale), two passes, cross-cell reconciliation, inline low-confidence flags. |
| Serverless cold start with a 13 MB WASM/model | First OCR slow (≈ 10 s) | Model and core are local files; worker is reused within an instance; UI sets expectations with a step-by-step progress screen. |
| Merged lab blocks spanning two periods | Lab gets 1 hour instead of 2 | Detected and documented as a known limitation; the row editor allows fixing the end time in two taps. |
| Users trust the draft blindly | Missed class | Week grid mirrors what will be exported; warnings are amber and specific; the export panel states the slot count. |
| Re-import duplicates events | Messy calendar | Stable `UID` derived from slot identity (no timestamps). |
| Timezone mistakes | Everything an hour off | Explicit timezone selector defaulted from the browser, `TZID`-anchored events, `UNTIL` in UTC, tested against New York DST. |

---

## 10. Scope of v1 (shipped) vs later

**Shipped**
PDF + photo + scanned PDF input; four layout strategies; room/faculty/code extraction; OCR reconciliation; editable review; week grid; term/timezone/holiday/reminder settings; `.ics` + `.csv` export; warnings and confidence; samples; health endpoint; tests; Docker + Vercel deploy; this PRD.

**Next (v1.1+)**
- Two-period merged-cell detection (infer 2-hour lab blocks).
- Multi-language OCR (Hindi/Gujarati/Tamil traineddata already supported by the loader).
- “Timetable changed” diff flow: upload the new PDF, get a patch `.ics` plus a diff summary.
- Shareable read-only week view (static page per timetable, no server state).
- Calendar feed URL (`webcal://`) so students subscribe instead of importing.
- Batch mode for a class rep: N photos → one calendar.

---

## 11. Why this is a good engineering story

1. **OCR pipeline** — preprocessing variants, confidence scoring, word-level geometry, worker reuse, graceful degradation.
2. **Parsing under uncertainty** — four layout detectors, phase-space band estimation, fallback chain, and heuristics that are individually testable.
3. **Recurrence & timezones** — `VTIMEZONE` generation from `Intl`, UTC `UNTIL`, `EXDATE` only where a class would occur, DST-safe wall-clock semantics, 75-octet folding.
4. **Product judgement** — the review UI, warning taxonomy and “never invent a field” rule are what make an 85 %-accurate parser actually usable.
5. **Distribution thinking** — no accounts, no storage, no keys: the cheapest possible thing to share in a class group, and the cheapest possible thing to deploy.
