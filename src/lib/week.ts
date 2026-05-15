/** Week boundaries use UTC calendar dates so server, API and DB stay aligned. */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** YYYY-MM-DD for a UTC calendar date. */
export function utcYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Monday (UTC) of the calendar week containing `d`, as YYYY-MM-DD. */
export function utcMondayKeyContaining(d: Date): string {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = new Date(t).getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const mondayMs = t + diff * 86400000;
  return utcYmd(new Date(mondayMs));
}

/** Parse `YYYY-MM-DD`; return null if invalid. */
export function parseUtcYmd(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Normalize any day to the Monday (UTC) of that week, as YYYY-MM-DD. */
export function normalizeToUtcMondayKey(input: string): string | null {
  const d = parseUtcYmd(input);
  if (!d) return null;
  return utcMondayKeyContaining(d);
}

export function mondayDateFromKey(mondayKey: string): Date {
  return new Date(`${mondayKey}T00:00:00.000Z`);
}

export function shiftUtcMondayKey(mondayKey: string, weekDelta: number): string {
  const d = parseUtcYmd(mondayKey);
  if (!d) return mondayKey;
  const t = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + weekDelta * 7,
  );
  return utcMondayKeyContaining(new Date(t));
}

/** Sunday end of sprint week (UTC), YYYY-MM-DD. */
export function utcSundayKeyAfterMonday(mondayKey: string): string {
  const d = parseUtcYmd(mondayKey);
  if (!d) return mondayKey;
  const sun = new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate() + 6,
    ),
  );
  return utcYmd(sun);
}

/** Display like 06.05.2026 — 12.05.2026 */
export function formatWeekRangeLabel(mondayKey: string): string {
  const mk = (key: string) => {
    const [y, m, day] = key.split("-").map(Number);
    return `${pad2(day)}.${pad2(m)}.${y}`;
  };
  return `${mk(mondayKey)} — ${mk(utcSundayKeyAfterMonday(mondayKey))}`;
}

/** Для Prisma: понедельник 00:00 UTC включительно, до следующего понедельника не включая. */
export function weekStartBoundsUtc(mondayKey: string): { gte: Date; lt: Date } {
  const gte = mondayDateFromKey(mondayKey);
  const lt = mondayDateFromKey(shiftUtcMondayKey(mondayKey, 1));
  return { gte, lt };
}
