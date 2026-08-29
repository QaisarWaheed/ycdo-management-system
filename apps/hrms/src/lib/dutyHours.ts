/** Daily duty length: 0.5–24 hours in half-hour steps (6.5 = 6h 30m). */
export function isValidDutyTotalHours(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (value < 0.5 || value > 24) return false
  return Math.abs(value - Math.round(value * 2) / 2) < 1e-6
}
