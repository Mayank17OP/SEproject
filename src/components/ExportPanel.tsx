'use client';

import { useMemo, useState } from 'react';
import type { ExportOptions, ParsedEvent } from '@/lib/types';
import { buildCsv } from '@/lib/csv';
import { formatDate, occurrences } from '@/lib/dates';
import { DownloadIcon, GoogleIcon, CopyIcon, CheckIcon, SpinnerIcon } from './icons';

interface ExportPanelProps {
  events: ParsedEvent[];
  options: ExportOptions;
  errors: string[];
}

type Busy = null | 'ics' | 'copy' | 'csv';

export default function ExportPanel({ events, options, errors }: ExportPanelProps) {
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const exportable = useMemo(
    () => events.filter((event) => !(options.skipBreaks && event.kind === 'break')),
    [events, options.skipBreaks],
  );

  const totalOccurrences = useMemo(
    () =>
      exportable.reduce(
        (sum, event) => sum + occurrences(options.startDate, options.endDate, event.day),
        0,
      ),
    [exportable, options.startDate, options.endDate],
  );

  const requestIcs = async (): Promise<string | null> => {
    const response = await fetch('/api/ics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events, options }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({ error: 'Could not build the calendar.' }))) as {
        error?: string;
      };
      setMessage({ kind: 'err', text: data.error ?? 'Could not build the calendar.' });
      return null;
    }
    return response.text();
  };

  const download = async () => {
    setBusy('ics');
    setMessage(null);
    try {
      const ics = await requestIcs();
      if (!ics) return;
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(options.calendarName || 'timetable').replace(/[^\w\-]+/g, '-').toLowerCase()}.ics`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setMessage({
        kind: 'ok',
        text: `Downloaded ${exportable.length} recurring classes (${totalOccurrences} events). Import it at calendar.google.com → Settings → Import & export.`,
      });
    } catch {
      setMessage({ kind: 'err', text: 'Network error while building the calendar. Try again.' });
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    setBusy('copy');
    setMessage(null);
    try {
      const ics = await requestIcs();
      if (!ics) return;
      await navigator.clipboard.writeText(ics);
      setMessage({ kind: 'ok', text: 'Calendar copied to the clipboard as .ics text.' });
    } catch {
      setMessage({ kind: 'err', text: 'Clipboard access was blocked — use the download instead.' });
    } finally {
      setBusy(null);
    }
  };

  const downloadCsv = () => {
    const csv = buildCsv(events, options);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(options.calendarName || 'timetable').replace(/[^\w\-]+/g, '-').toLowerCase()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setMessage({ kind: 'ok', text: 'CSV downloaded — handy for a spreadsheet or printing.' });
  };

  const disabled = errors.length > 0 || exportable.length === 0;

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Add to your calendar</h3>
          <p className="text-xs text-slate-500">
            {formatDate(options.startDate)} → {formatDate(options.endDate)} · {options.timeZone.replace(/_/g, ' ')}
          </p>
        </div>
        <span className="chip shrink-0 border-mint-400/30 bg-mint-400/10 text-mint-400">
          {exportable.length} slots · {totalOccurrences} classes
        </span>
      </div>

      {errors.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {errors.map((error) => (
            <li key={error}>• {error}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={download} disabled={disabled || busy === 'ics'} className="btn-primary">
          {busy === 'ics' ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : <DownloadIcon className="h-4 w-4" />}
          Download .ics
        </button>
        <a
          href="https://calendar.google.com/calendar/u/0/r/settings/export"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost"
        >
          <GoogleIcon className="h-4 w-4" /> Google Calendar import
        </a>
        <button type="button" onClick={copy} disabled={disabled || busy === 'copy'} className="btn-ghost">
          {busy === 'copy' ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : <CopyIcon className="h-4 w-4" />}
          Copy ICS text
        </button>
        <button type="button" onClick={downloadCsv} disabled={!exportable.length} className="btn-quiet border border-white/10">
          <DownloadIcon className="h-4 w-4" /> Download CSV
        </button>
      </div>

      {message && (
        <div
          className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
            message.kind === 'ok'
              ? 'border-mint-400/30 bg-mint-400/10 text-mint-400'
              : 'border-rose-400/30 bg-rose-500/10 text-rose-200'
          }`}
        >
          {message.kind === 'ok' ? <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <span>⚠</span>}
          <span>{message.text}</span>
        </div>
      )}

      <details className="group mt-4 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
        <summary className="cursor-pointer list-none text-xs font-medium text-slate-300">
          How do I import this? <span className="text-slate-500 group-open:hidden">(3 steps)</span>
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-slate-400">
          <li>Open Google Calendar on a laptop → gear icon → <strong>Settings</strong>.</li>
          <li>Pick <strong>Import &amp; export</strong> → choose the downloaded <code>.ics</code> → pick a calendar → <strong>Import</strong>.</li>
          <li>Apple Calendar / Outlook: just double-click the file. Phone: open it from Files → “Add All”.</li>
        </ol>
        <p className="mt-2 text-[0.68rem] text-slate-500">
          Re-importing the same file updates the existing events instead of duplicating them, because every
          event keeps a stable UID.
        </p>
      </details>
    </div>
  );
}
