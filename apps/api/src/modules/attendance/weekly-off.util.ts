import { toPakistanDateOnly } from './attendance-late.util';

/** JS weekday: 0 Sunday … 6 Saturday, on the Pakistan calendar date. */
export function normalizeWeeklyOffWeekdays(
  raw: number[] | null | undefined,
): number[] {
  if (raw == null || raw.length === 0) return [];
  const unique = new Set<number>();
  for (const value of raw) {
    if (!Number.isInteger(value) || value < 0 || value > 6) {
      throw new Error('weeklyOffWeekdays must be integers 0–6');
    }
    unique.add(value);
  }
  return [...unique].sort((a, b) => a - b);
}

export function isWeeklyOffDate(
  weeklyOffWeekdays: number[] | null | undefined,
  date: Date,
): boolean {
  if (!weeklyOffWeekdays?.length) return false;
  return weeklyOffWeekdays.includes(toPakistanDateOnly(date).getUTCDay());
}
