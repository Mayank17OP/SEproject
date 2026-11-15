'use client';

import { useMemo } from 'react';
import type { ParsedEvent } from '@/lib/types';
import { DAY_SHORT, to12h } from '@/lib/time';

const HUES = [232, 168, 288, 24, 208, 340, 124, 46];

function hueFor(subject: string): number {
  let hash = 0;
  for (let i = 0; i < subject.length; i++) hash = (hash * 31 + subject.charCodeAt(i)) % 9973;
  return HUES[hash % HUES.length];
}

interface WeekGridProps {
  events: ParsedEvent[];
  onSelect?: (event: ParsedEvent) => void;
}

export default function WeekGrid({ events, onSelect }: WeekGridProps) {
  const { days, slots } = useMemo(() => {
    const classes = events.filter((e) => e.kind !== 'break');
    const daySet = [...new Set(classes.map((e) => e.day))].sort((a, b) => a - b);
    const slotMap = new Map<string, { start: string; end: string }>();
    for (const event of classes) {
      if (!slotMap.has(event.start)) slotMap.set(event.start, { start: event.start, end: event.end });
    }
    const slots = [...slotMap.values()].sort((a, b) => a.start.localeCompare(b.start));
    return { days: daySet, slots };
  }, [events]);

  const lookup = useMemo(() => {
    const map = new Map<string, ParsedEvent[]>();
    for (const event of events) {
      const key = `${event.day}|${event.start}`;
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [events]);

  if (!days.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-8 text-center text-sm text-slate-400">
        Nothing to preview yet — add a class below and it will show up here.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="bg-white/[0.04]">
            <th className="sticky left-0 z-10 bg-[#0b0f1c] px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">
              Time
            </th>
            {days.map((day) => (
              <th key={day} className="px-2 py-2 text-center text-[0.7rem] font-bold uppercase tracking-wider text-brand-400">
                {DAY_SHORT[day]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.start} className="border-t border-white/[0.06]">
              <th className="sticky left-0 z-10 whitespace-nowrap bg-[#0b0f1c] px-3 py-2 align-top text-[0.68rem] font-medium text-slate-400">
                {to12h(slot.start)}
                <span className="block text-[0.62rem] text-slate-600">{to12h(slot.end)}</span>
              </th>
              {days.map((day) => {
                const cellEvents = lookup.get(`${day}|${slot.start}`) ?? [];
                return (
                  <td key={day} className="p-1 align-top">
                    {cellEvents.length === 0 ? (
                      <div className="h-full min-h-[46px] rounded-md bg-white/[0.015]" />
                    ) : (
                      <div className="space-y-1">
                        {cellEvents.map((event) => {
                          const hue = hueFor(event.subject);
                          const isBreak = event.kind === 'break';
                          return (
                            <button
                              key={event.id}
                              type="button"
                              onClick={() => onSelect?.(event)}
                              className="block w-full rounded-md px-2 py-1.5 text-left transition hover:brightness-125"
                              style={{
                                background: isBreak
                                  ? 'rgba(148,163,184,0.12)'
                                  : `hsl(${hue} 70% 60% / 0.16)`,
                                boxShadow: isBreak ? 'none' : `inset 0 0 0 1px hsl(${hue} 70% 65% / 0.3)`,
                              }}
                              title={event.raw}
                            >
                              <span
                                className="block truncate text-[0.72rem] font-semibold leading-tight"
                                style={{ color: isBreak ? '#94a3b8' : `hsl(${hue} 85% 82%)` }}
                              >
                                {event.subject}
                                {event.code ? <span className="ml-1 opacity-60">{event.code}</span> : null}
                              </span>
                              <span className="mt-0.5 block truncate text-[0.63rem] text-slate-400">
                                {[event.room, event.faculty].filter(Boolean).join(' · ') || (isBreak ? 'break' : '—')}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
