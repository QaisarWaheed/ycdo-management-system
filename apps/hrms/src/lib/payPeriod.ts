/** Req 4: "Pays 16 Oct 2026 – 15 Jan 2027" for a start month/day and optional end month/day. */
export function payPeriodText(
  start: { year: number; month: number; day?: number | null },
  end?: { year: number; month: number; day?: number | null } | null,
): string {
  const fmt = (y: number, m: number, d: number) =>
    new Date(y, m - 1, d).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  const from = fmt(start.year, start.month, start.day || 1)
  if (!end) return `Pays from ${from} until stopped.`
  const lastDay = new Date(end.year, end.month, 0).getDate()
  const to = fmt(end.year, end.month, Math.min(end.day || lastDay, lastDay))
  return `Pays ${from} – ${to}, then stops automatically. A part month pays its calendar days.`
}
