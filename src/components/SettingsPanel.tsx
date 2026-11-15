'use client';

import type { ExportOptions } from '@/lib/types';
import { COMMON_TIMEZONES } from '@/lib/tz';
import { addDays, weeksBetween } from '@/lib/dates';

interface SettingsPanelProps {
  options: ExportOptions;
  onChange: (options: ExportOptions) => void;
  timeZoneGuess: string;
}

const REMINDERS = [
  { value: 0, label: 'No reminder' },
  { value: 5, label: '5 min before' },
  { value: 10, label: '10 min before' },
  { value: 15, label: '15 min before' },
  { value: 30, label: '30 min before' },
  { value: 60, label: '1 hour before' },
];

export default function SettingsPanel({ options, onChange, timeZoneGuess }: SettingsPanelProps) {
  const patch = (partial: Partial<ExportOptions>) => onChange({ ...options, ...partial });
  const zones = [...new Set([options.timeZone, timeZoneGuess, 'Asia/Kolkata', ...COMMON_TIMEZONES].filter(Boolean))];
  const weeks = weeksBetween(options.startDate, options.endDate);

  return (
    <div className="card p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Term &amp; recurrence</h3>
          <p className="text-xs text-slate-500">
            The calendar repeats weekly between these dates — that is how many semesters work.
          </p>
        </div>
        <span className="chip shrink-0">{weeks} weeks</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="calendar-name">
            Calendar name
          </label>
          <input
            id="calendar-name"
            value={options.calendarName}
            onChange={(e) => patch({ calendarName: e.target.value })}
            className="input"
            placeholder="CSE Sem 3"
            maxLength={80}
          />
        </div>

        <div>
          <label className="label" htmlFor="timezone">
            Timezone
          </label>
          <select
            id="timezone"
            value={options.timeZone}
            onChange={(e) => patch({ timeZone: e.target.value })}
            className="select"
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="start-date">
            First day of term
          </label>
          <input
            id="start-date"
            type="date"
            value={options.startDate}
            onChange={(e) => patch({ startDate: e.target.value })}
            className="input"
          />
        </div>

        <div>
          <label className="label" htmlFor="end-date">
            Last day of classes
          </label>
          <input
            id="end-date"
            type="date"
            value={options.endDate}
            onChange={(e) => patch({ endDate: e.target.value })}
            className="input"
          />
        </div>

        <div>
          <label className="label" htmlFor="reminder">
            Reminder
          </label>
          <select
            id="reminder"
            value={options.reminderMinutes}
            onChange={(e) => patch({ reminderMinutes: Number(e.target.value) })}
            className="select"
          >
            {REMINDERS.map((reminder) => (
              <option key={reminder.value} value={reminder.value}>
                {reminder.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="holidays">
            Holidays (optional)
          </label>
          <input
            id="holidays"
            value={options.holidays.join(', ')}
            onChange={(e) =>
              patch({
                holidays: e.target.value
                  .split(/[,\s]+/)
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
            className="input"
            placeholder="2026-01-26, 2026-03-04"
          />
          <p className="mt-1 text-[0.68rem] text-slate-500">
            Dates are skipped with EXDATE — only for classes that would have happened that day.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <QuickRange label="16 weeks" days={112} options={options} patch={patch} />
        <QuickRange label="12 weeks" days={84} options={options} patch={patch} />
        <QuickRange label="End of semester (20w)" days={140} options={options} patch={patch} />
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Toggle
          checked={options.skipBreaks}
          onChange={(checked) => patch({ skipBreaks: checked })}
          label="Skip lunch / free periods"
        />
        <Toggle
          checked={options.includeLocation}
          onChange={(checked) => patch({ includeLocation: checked })}
          label="Room as location"
        />
        <Toggle
          checked={options.includeFaculty}
          onChange={(checked) => patch({ includeFaculty: checked })}
          label="Teacher in notes"
        />
      </div>
    </div>
  );
}

function QuickRange({
  label,
  days,
  options,
  patch,
}: {
  label: string;
  days: number;
  options: ExportOptions;
  patch: (partial: Partial<ExportOptions>) => void;
}) {
  const active = options.startDate ? addDays(options.startDate, days) === options.endDate : false;
  return (
    <button
      type="button"
      onClick={() => patch({ endDate: addDays(options.startDate, days) })}
      className={`rounded-full border px-3 py-1 text-[0.7rem] font-medium transition ${
        active
          ? 'border-brand-400/60 bg-brand-500/15 text-brand-400'
          : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/25 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-300 transition hover:border-white/20">
      <span
        className={`relative h-4 w-7 shrink-0 rounded-full transition ${checked ? 'bg-brand-500' : 'bg-white/15'}`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${checked ? 'left-3.5' : 'left-0.5'}`}
        />
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      {label}
    </label>
  );
}
