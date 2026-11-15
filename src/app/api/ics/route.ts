import { NextResponse } from 'next/server';
import { buildIcs, validateOptions } from '@/lib/ics';
import { isValidTimeZone } from '@/lib/tz';
import type { ExportOptions, ParsedEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Payload {
  events?: ParsedEvent[];
  options?: Partial<ExportOptions>;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'timetable'
  );
}

export async function POST(request: Request) {
  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ error: 'Body must be JSON: { events, options }.' }, { status: 400 });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  if (!events.length) {
    return NextResponse.json({ error: 'There are no classes to export yet.' }, { status: 400 });
  }
  if (events.length > 200) {
    return NextResponse.json({ error: 'Too many events (max 200).' }, { status: 400 });
  }

  const options: ExportOptions = {
    calendarName: payload.options?.calendarName?.slice(0, 120) || 'Class Timetable',
    timeZone: payload.options?.timeZone || 'Asia/Kolkata',
    startDate: payload.options?.startDate || '',
    endDate: payload.options?.endDate || '',
    holidays: (payload.options?.holidays ?? []).slice(0, 100),
    reminderMinutes: Number.isFinite(payload.options?.reminderMinutes) ? Number(payload.options?.reminderMinutes) : 10,
    includeLocation: payload.options?.includeLocation !== false,
    includeFaculty: payload.options?.includeFaculty !== false,
    skipBreaks: payload.options?.skipBreaks !== false,
  };

  if (!isValidTimeZone(options.timeZone)) {
    return NextResponse.json({ error: `Unknown timezone "${options.timeZone}".` }, { status: 400 });
  }

  const errors = validateOptions(options);
  if (errors.length) {
    return NextResponse.json({ error: errors.join(' ') }, { status: 400 });
  }

  const sanitisedEvents = events
    .filter((event) => typeof event?.subject === 'string' && event.subject.trim().length > 0)
    .map((event) => ({
      ...event,
      subject: event.subject.slice(0, 200),
      code: event.code?.slice(0, 20),
      room: event.room?.slice(0, 60),
      faculty: event.faculty?.slice(0, 120),
      start: /^\d{2}:\d{2}$/.test(event.start) ? event.start : '09:00',
      end: /^\d{2}:\d{2}$/.test(event.end) ? event.end : '10:00',
      day: Math.min(6, Math.max(0, Math.round(Number(event.day) || 0))),
      kind: event.kind === 'break' ? ('break' as const) : event.kind === 'lab' ? ('lab' as const) : ('class' as const),
      confidence: Number(event.confidence) || 0.5,
      id: String(event.id ?? Math.random().toString(36).slice(2)),
    }));

  const { ics, eventCount, skipped } = buildIcs(sanitisedEvents, options);
  const fileName = `${slugify(options.calendarName)}.ics`;

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
      'X-Event-Count': String(eventCount),
      'X-Events-Skipped': String(skipped),
    },
  });
}
