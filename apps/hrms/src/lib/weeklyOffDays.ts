export const WEEKDAY_OFF_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
] as const

export function formatWeeklyOffWeekdays(
  days?: number[] | null,
): string {
  if (!days?.length) return 'None (7-day week)'
  const selected = new Set(days)
  return WEEKDAY_OFF_OPTIONS.filter((d) => selected.has(d.value))
    .map((d) => d.label)
    .join(', ')
}

export function toggleWeeklyOffDay(days: number[], day: number): number[] {
  const next = new Set(days)
  if (next.has(day)) next.delete(day)
  else next.add(day)
  return [...next].sort((a, b) => a - b)
}
