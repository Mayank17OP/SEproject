/** Small, dependency-free date helpers (all dates are plain "YYYY-MM-DD" strings). */

export function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(iso: string, days: number): string {
  const date = fromIso(iso);
  date.setDate(date.getDate() + days);
  return toIso(date);
}

export function nextMonday(base = new Date()): string {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const day = date.getDay();
  const delta = day === 1 ? 0 : (8 - day) % 7;
  date.setDate(date.getDate() + delta);
  return toIso(date);
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!iso) return '';
  try {
    return fromIso(iso).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...opts,
    });
  } catch {
    return iso;
  }
}

export function daysBetween(startIso: string, endIso: string): number {
  return Math.round((fromIso(endIso).getTime() - fromIso(startIso).getTime()) / 86_400_000);
}

export function weeksBetween(startIso: string, endIso: string): number {
  return Math.max(0, Math.round(daysBetween(startIso, endIso) / 7));
}

/** How many times a weekday occurs between two dates (inclusive). */
export function occurrences(startIso: string, endIso: string, weekday: number): number {
  const span = daysBetween(startIso, endIso);
  if (span < 0) return 0;
  const first = fromIso(startIso);
  let offset = (weekday - first.getDay() + 7) % 7;
  if (offset > span) return 0;
  return Math.floor((span - offset) / 7) + 1;
}
