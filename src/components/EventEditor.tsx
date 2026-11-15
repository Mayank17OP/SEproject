'use client';

import { useMemo, useState } from 'react';
import type { ParsedEvent } from '@/lib/types';
import { DAY_NAMES, DAY_SHORT } from '@/lib/time';
import { PlusIcon, TrashIcon } from './icons';

interface EventEditorProps {
  events: ParsedEvent[];
  onChange: (events: ParsedEvent[]) => void;
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function EventEditor({ events, onChange }: EventEditorProps) {
  const [showAll, setShowAll] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<number, ParsedEvent[]>();
    for (const event of events) {
      const list = map.get(event.day) ?? [];
      list.push(event);
      map.set(event.day, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.start.localeCompare(b.start));
    return map;
  }, [events]);

  const days = DAY_ORDER.filter((day) => grouped.has(day));
  const visibleDays = showAll ? days : days.slice(0, 3);

  const update = (id: string, patch: Partial<ParsedEvent>) => {
    onChange(events.map((event) => (event.id === id ? { ...event, ...patch } : event)));
  };

  const remove = (id: string) => onChange(events.filter((event) => event.id !== id));

  const add = () => {
    const day = days[0] ?? 1;
    const last = grouped.get(day)?.slice(-1)[0];
    const newEvent: ParsedEvent = {
      id: `manual-${Math.random().toString(36).slice(2, 8)}`,
      day,
      start: last?.end ?? '09:00',
      end: last ? bumpEnd(last.end) : '10:00',
      subject: 'New class',
      kind: 'class',
      confidence: 1,
      room: '',
      faculty: '',
    };
    onChange([...events, newEvent]);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">Check &amp; fix the details</h3>
          <p className="text-xs text-slate-500">
            Every field is editable. Mistakes here become wrong reminders for the whole semester.
          </p>
        </div>
        <button type="button" onClick={add} className="btn-ghost px-3 py-1.5 text-xs">
          <PlusIcon className="h-3.5 w-3.5" /> Add class
        </button>
      </div>

      {visibleDays.map((day) => (
        <div key={day} className="card-tight overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.03] px-3 py-2">
            <span className="tag-day">{DAY_SHORT[day]}</span>
            <span className="text-[0.68rem] text-slate-500">
              {grouped.get(day)!.filter((e) => e.kind !== 'break').length} classes
            </span>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {grouped.get(day)!.map((event) => (
              <div key={event.id} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-center">
                <div className="flex items-center gap-1.5">
                  <input
                    type="time"
                    value={event.start}
                    onChange={(e) => update(event.id, { start: e.target.value })}
                    className="input w-[6.6rem] px-2 py-1 text-xs"
                    aria-label="Start time"
                  />
                  <span className="text-xs text-slate-600">–</span>
                  <input
                    type="time"
                    value={event.end}
                    onChange={(e) => update(event.id, { end: e.target.value })}
                    className="input w-[6.6rem] px-2 py-1 text-xs"
                    aria-label="End time"
                  />
                </div>

                <input
                  value={event.subject}
                  onChange={(e) => update(event.id, { subject: e.target.value })}
                  placeholder="Subject"
                  className={`input px-2 py-1 text-sm ${event.kind === 'break' ? 'text-slate-400' : 'font-medium'}`}
                  aria-label="Subject"
                />

                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    value={event.room ?? ''}
                    onChange={(e) => update(event.id, { room: e.target.value })}
                    placeholder="Room"
                    className="input px-2 py-1 text-xs"
                    aria-label="Room"
                  />
                  <input
                    value={event.faculty ?? ''}
                    onChange={(e) => update(event.id, { faculty: e.target.value })}
                    placeholder="Faculty"
                    className="input px-2 py-1 text-xs"
                    aria-label="Faculty"
                  />
                </div>

                <div className="flex items-center justify-end gap-1">
                  <select
                    value={event.day}
                    onChange={(e) => update(event.id, { day: Number(e.target.value) })}
                    className="select w-[5.4rem] px-2 py-1 text-xs"
                    aria-label="Day"
                  >
                    {DAY_NAMES.map((name, index) => (
                      <option key={name} value={index}>
                        {DAY_SHORT[index]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => remove(event.id)}
                    className="rounded-md p-1.5 text-slate-500 transition hover:bg-rose-500/15 hover:text-rose-300"
                    aria-label={`Remove ${event.subject}`}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>

                {event.confidence < 0.75 && event.kind !== 'break' && (
                  <p className="text-[0.65rem] text-amber-300/80 sm:col-span-4">
                    Low confidence read — double-check this one.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {days.length > 3 && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="btn-quiet w-full border border-white/10 py-2 text-xs"
        >
          {showAll ? 'Show fewer days' : `Show all ${days.length} days`}
        </button>
      )}
    </div>
  );
}

function bumpEnd(end: string): string {
  const [h, m] = end.split(':').map(Number);
  const total = (h * 60 + m + 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
