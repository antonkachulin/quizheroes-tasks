/** Старые шаблоны: weekly / biweekly / monthly (остаются в БД, runner учитывает). */
export const RECURRENCE_TYPES = ["weekly", "biweekly", "monthly"] as const;
export type RecurrenceType = (typeof RECURRENCE_TYPES)[number];

export function isRecurrenceType(v: string): v is RecurrenceType {
  return (RECURRENCE_TYPES as readonly string[]).includes(v);
}

/** Следующая дата по старому типу (UTC). */
export function addRecurrenceInterval(from: Date, type: RecurrenceType): Date {
  const d = new Date(from.getTime());
  if (type === "weekly") {
    d.setUTCDate(d.getUTCDate() + 7);
    return d;
  }
  if (type === "biweekly") {
    d.setUTCDate(d.getUTCDate() + 14);
    return d;
  }
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** Календарные дни по UTC. */
export function addCalendarDaysUtc(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Первая дата следующего срабатывания: сейчас + N дней. */
export function computeInitialRecurrenceNextDateDays(days: number): Date {
  return addCalendarDaysUtc(new Date(), days);
}

/** Сохраняет смещение относительно weekStart задачи при переносе на новый понедельник. */
export function shiftPreservingWeekOffset(
  taskWeekStart: Date | null,
  original: Date | null,
  targetWeekStart: Date,
): Date | null {
  if (!original) return null;
  if (!taskWeekStart) {
    return new Date(original.getTime());
  }
  const delta = original.getTime() - taskWeekStart.getTime();
  return new Date(targetWeekStart.getTime() + delta);
}
