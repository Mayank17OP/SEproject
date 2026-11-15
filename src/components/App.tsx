'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ExportOptions, ParsedEvent, ParseResult } from '@/lib/types';
import type { ParseResponse } from '@/lib/api-types';
import { validateOptions } from '@/lib/ics';
import { addDays, nextMonday, weeksBetween } from '@/lib/dates';
import { DAY_NAMES } from '@/lib/time';
import Uploader from './Uploader';
import WeekGrid from './WeekGrid';
import EventEditor from './EventEditor';
import SettingsPanel from './SettingsPanel';
import ExportPanel from './ExportPanel';
import { ArrowRightIcon, CalendarIcon, CheckIcon, GithubIcon, ShieldIcon, SparkIcon, WarningIcon } from './icons';

type Stage = 'idle' | 'working' | 'review';

const PDF_STEPS = [
  'Reading the PDF…',
  'Extracting the text layer…',
  'Finding the timetable grid…',
  'Matching rooms and teachers…',
];

const IMAGE_STEPS = [
  'Straightening and cleaning the photo…',
  'Running OCR over every cell…',
  'Finding the timetable grid…',
  'Matching rooms and teachers…',
];

function defaultOptions(): ExportOptions {
  const timeZone =
    (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Asia/Kolkata';
  const start = nextMonday();
  return {
    calendarName: 'My Class Timetable',
    timeZone,
    startDate: start,
    endDate: addDays(start, 7 * 16 - 1),
    holidays: [],
    reminderMinutes: 10,
    includeLocation: true,
    includeFaculty: true,
    skipBreaks: true,
  };
}

export default function App() {
  const [stage, setStage] = useState<Stage>('idle');
  const [stepIndex, setStepIndex] = useState(0);
  const [isImage, setIsImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResponse | null>(null);
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [options, setOptions] = useState<ExportOptions>(() => defaultOptions());
  const [timeZoneGuess, setTimeZoneGuess] = useState('Asia/Kolkata');
  const reviewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (zone) {
        setTimeZoneGuess(zone);
        setOptions((current) => ({ ...current, timeZone: current.timeZone || zone }));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (stage !== 'working') return;
    const steps = isImage ? IMAGE_STEPS : PDF_STEPS;
    const timer = setInterval(() => setStepIndex((index) => Math.min(index + 1, steps.length - 1)), 1400);
    return () => clearInterval(timer);
  }, [stage, isImage]);

  const upload = useCallback(async (file: File) => {
    setError(null);
    setResult(null);
    setEvents([]);
    setIsImage(!/pdf$/i.test(file.name) && !file.type.includes('pdf'));
    setStage('working');
    setStepIndex(0);

    const body = new FormData();
    body.append('file', file);

    try {
      const response = await fetch('/api/parse', { method: 'POST', body });
      const data = (await response.json()) as ParseResponse | { error: string };
      if (!response.ok || 'error' in data) {
        setError(('error' in data && data.error) || 'That file could not be read.');
        setStage('idle');
        return;
      }
      setResult(data);
      setEvents(data.events);
      setOptions((current) => ({ ...current, calendarName: suggestName(data.source.fileName) }));
      setStage('review');
      requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch {
      setError('Upload failed. Check your connection and try again.');
      setStage('idle');
    }
  }, []);

  const onSample = useCallback(async (url: string, label: string) => {
    try {
      setStage('working');
      setIsImage(/\.(jpe?g|png|webp)$/i.test(url));
      setStepIndex(0);
      const response = await fetch(url);
      const blob = await response.blob();
      await upload(new File([blob], label, { type: blob.type || 'application/pdf' }));
    } catch {
      setError('Could not load the sample file.');
      setStage('idle');
    }
  }, [upload]);

  const optionErrors = useMemo(() => validateOptions(options), [options]);
  const classes = useMemo(() => events.filter((event) => event.kind !== 'break'), [events]);
  const daysUsed = useMemo(() => new Set(classes.map((event) => event.day)).size, [classes]);
  const rooms = useMemo(() => new Set(classes.map((event) => event.room).filter(Boolean)).size, [classes]);
  const faculty = useMemo(() => new Set(classes.map((event) => event.faculty).filter(Boolean)).size, [classes]);
  const weeks = weeksBetween(options.startDate, options.endDate);

  const reset = () => {
    setStage('idle');
    setResult(null);
    setEvents([]);
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 sm:px-6 lg:px-8">
      <Header />

      {stage === 'idle' && (
        <section className="animate-rise">
          <Hero />
          <div className="mt-6 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
            <Uploader
              busy={false}
              progressLabel="Working…"
              error={error}
              onFile={upload}
              onSample={onSample}
            />
            <SidePanel />
          </div>
        </section>
      )}

      {stage === 'working' && (
        <section className="mt-6">
          <Uploader
            busy
            progressLabel={(isImage ? IMAGE_STEPS : PDF_STEPS)[stepIndex]}
            error={error}
            onFile={upload}
            onSample={onSample}
            compact
          />
          <div className="card mt-4 p-6">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-brand-500/15 text-brand-400">
                <SparkIcon className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">
                  {(isImage ? IMAGE_STEPS : PDF_STEPS)[stepIndex]}
                </p>
                <p className="text-xs text-slate-500">
                  Everything runs in a single request — no upload to a third party, no queue.
                </p>
              </div>
            </div>
            <div className="mt-4 flex gap-1.5">
              {(isImage ? IMAGE_STEPS : PDF_STEPS).map((step, index) => (
                <span
                  key={step}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    index <= stepIndex ? 'bg-brand-500' : 'bg-white/10'
                  }`}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {stage === 'review' && result && (
        <section ref={reviewRef} className="mt-6 scroll-mt-6 space-y-4 pb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-white sm:text-2xl">
                {classes.length ? `${classes.length} classes found` : 'Nothing parsed yet'}
              </h2>
              <p className="text-sm text-slate-400">
                {result.source.kind === 'pdf-text'
                  ? 'Read straight from the PDF text layer — should be near-perfect.'
                  : `Read with OCR${result.source.ocrConfidence ? ` at ${Math.round(result.source.ocrConfidence)}% confidence` : ''} — skim the list before exporting.`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={reset} className="btn-ghost text-xs">
                Upload another file
              </button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Weekly slots" value={String(classes.length)} hint="recurring events" />
            <Stat label="Days used" value={String(daysUsed)} hint={[...new Set(classes.map((e) => e.day))].sort().map((d) => DAY_NAMES[d].slice(0, 3)).join(' · ') || '—'} />
            <Stat label="Rooms" value={String(rooms)} hint="detected" />
            <Stat label="Teachers" value={String(faculty)} hint="detected" />
          </div>

          {result.warnings.length > 0 && <Warnings warnings={result.warnings} />}

          <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
            <div className="space-y-4">
              <div className="card p-4 sm:p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Your week</h3>
                  <span className="chip">
                    {weeks} weeks · {options.timeZone.replace(/_/g, ' ')}
                  </span>
                </div>
                <WeekGrid events={events} />
              </div>
              <EventEditor events={events} onChange={setEvents} />
            </div>

            <div className="space-y-4">
              <SettingsPanel options={options} onChange={setOptions} timeZoneGuess={timeZoneGuess} />
              <ExportPanel events={events} options={options} errors={optionErrors} />
              <div className="card-tight p-4">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
                  <ShieldIcon className="h-4 w-4 text-mint-400" /> What happens to my file?
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  It is parsed in memory by this server, the classes are sent back to your browser, and the
                  file is dropped. No account, no database, no analytics on file contents, no retention.
                  Because the download is generated in your browser, nobody else ever sees your timetable.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {stage === 'idle' && <Faq />}

      <Footer />
    </main>
  );
}

function Header() {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-lg shadow-brand-600/30">
          <CalendarIcon className="h-5 w-5" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">Timetable → Calendar</p>
          <p className="text-[0.68rem] text-slate-500">one photo, one .ics, zero typing</p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <a
          href="https://github.com/Mayank17OP/SEproject"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-quiet px-2.5 py-2"
          aria-label="Source on GitHub"
        >
          <GithubIcon className="h-4 w-4" />
        </a>
        <a href="#faq" className="btn-quiet hidden px-3 py-2 text-xs sm:inline-flex">
          How it works
        </a>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <div className="mt-8 max-w-2xl sm:mt-12">
      <span className="chip mb-4">
        <SparkIcon className="h-3.5 w-3.5 text-brand-400" /> PDF or photo · rooms + teachers included
      </span>
      <h1 className="text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl">
        Turn your college timetable into a{' '}
        <span className="bg-gradient-to-r from-brand-400 to-mint-400 bg-clip-text text-transparent">
          real calendar
        </span>
        .
      </h1>
      <p className="mt-4 text-base leading-relaxed text-slate-400 sm:text-lg">
        Upload the PDF from your department WhatsApp group — or just photograph the sheet on the notice
        board. You get an <code className="rounded bg-white/10 px-1.5 py-0.5 text-[0.85em]">.ics</code> file
        where every class repeats weekly with the room, the teacher and a 10-minute reminder.
      </p>
    </div>
  );
}

function SidePanel() {
  const items = [
    ['Works from a photo', 'OCR straightens, cleans and reads the table — no need to retype anything.'],
    ['Rooms & faculty', 'Each event carries the room as its location and the teacher in the notes.'],
    ['Weekly recurrence', 'One event per slot, repeated to the end of term, with holidays skipped.'],
    ['Real timezones', 'A proper VTIMEZONE block, so 9 AM stays 9 AM even if you travel.'],
  ];
  return (
    <aside className="card p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-white">What you get</h2>
      <ul className="mt-3 space-y-3">
        {items.map(([title, body]) => (
          <li key={title} className="flex gap-3">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-mint-400/15 text-mint-400">
              <CheckIcon className="h-3.5 w-3.5" />
            </span>
            <div>
              <p className="text-sm font-medium text-slate-200">{title}</p>
              <p className="text-xs leading-relaxed text-slate-500">{body}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="divider my-4" />
      <p className="flex items-start gap-2 text-xs text-slate-500">
        <ShieldIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-400" />
        Files are processed in memory and never stored. Free, no signup, works on your phone.
      </p>
    </aside>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card-tight px-3 py-2.5">
      <p className="text-[0.65rem] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-white">{value}</p>
      <p className="truncate text-[0.68rem] text-slate-500">{hint}</p>
    </div>
  );
}

function Warnings({ warnings }: { warnings: ParseResult['warnings'] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="card border-amber-300/20 bg-amber-400/[0.05] p-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-amber-200">
          <WarningIcon className="h-4 w-4" /> {warnings.length} thing{warnings.length > 1 ? 's' : ''} to double-check
        </span>
        <span className="text-xs text-amber-200/70">{open ? 'hide' : 'show'}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-amber-100/80">
          {warnings.slice(0, 8).map((warning, index) => (
            <li key={`${warning.code}-${index}`} className="flex gap-2">
              <span className="text-amber-300/70">•</span>
              <span>{warning.message}</span>
            </li>
          ))}
          {warnings.length > 8 && <li className="text-amber-200/60">…and {warnings.length - 8} more.</li>}
        </ul>
      )}
    </div>
  );
}

function Faq() {
  const items: Array<[string, string]> = [
    [
      'Will it work on my college’s weird timetable format?',
      'The parser understands both common layouts — weekdays down the left with times across the top, and weekdays across the top with times down the side. It also handles period numbers (P1, P2…) with a time legend, merged cells, single-page and multi-page PDFs, and free-form "MON 9:00–10:00 DS Room 204" lines. When it is unsure it says so instead of silently guessing.',
    ],
    [
      'What about photos?',
      'Photos are de-rotated, grayscaled, normalised and upscaled before OCR, and each cell is read independently. Then every teacher and room spelling is normalised against the rest of the document, so one bad read does not turn into one bad calendar entry. If OCR confidence is low you get a warning and can fix the row in seconds.',
    ],
    [
      'How do I get it into Google Calendar?',
      'Download the .ics on a laptop, then Google Calendar → Settings → Import & export → Import. On Android/iOS you can open the file straight from Files or the download tray. Apple Calendar and Outlook just need a double-click.',
    ],
    [
      'What if the semester dates change?',
      'Set the first and last day of classes in the Term panel. The events use a weekly RRULE with a UTC UNTIL, so they stop exactly on the last day — and re-importing an updated file updates the same events rather than duplicating them.',
    ],
    [
      'Is my timetable uploaded anywhere?',
      'No. The file is posted to this app’s own server, parsed in memory, and discarded. There is no database, no user account and no third-party OCR service. Downloading the calendar happens entirely in your browser.',
    ],
  ];
  return (
    <section id="faq" className="mt-12 scroll-mt-6">
      <h2 className="text-lg font-semibold text-white">Questions students actually ask</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {items.map(([question, answer]) => (
          <details key={question} className="card group p-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-200">
              {question}
              <ArrowRightIcon className="h-4 w-4 shrink-0 text-slate-500 transition group-open:rotate-90" />
            </summary>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mt-14 border-t border-white/[0.07] pt-6 text-xs text-slate-500">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          Built with Next.js, pdf.js and tesseract.js · RFC 5545 compliant .ics writer (VTIMEZONE, RRULE,
          EXDATE, 75-octet folding).
        </p>
        <p className="text-slate-600">No tracking · no accounts · no ads</p>
      </div>
    </footer>
  );
}

function suggestName(fileName: string): string {
  const base = fileName
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!base || /^(img|image|scan|photo|screenshot|whatsapp)[\s\d-]*$/i.test(base)) return 'My Class Timetable';
  return base.slice(0, 60);
}
