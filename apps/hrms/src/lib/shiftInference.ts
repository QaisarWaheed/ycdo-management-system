export const SHIFT_PERIOD_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Day', value: 'Morning' },
  { label: 'Evening', value: 'Evening' },
  { label: 'Night', value: 'Night' },
  { label: '24 Hours', value: '24 Hours' },
] as const

export function inferShiftNameFromDuty(
  dutyStartTime?: string | null,
  dutyEndTime?: string | null,
  dutyTotalHours?: number | null,
): string | null {
  if (!dutyStartTime) return null

  if (
    dutyTotalHours === 24 ||
    (dutyStartTime === '00:00' && dutyEndTime === '23:59')
  ) {
    return '24 Hours'
  }

  const hour = parseInt(dutyStartTime.split(':')[0], 10)
  if (Number.isNaN(hour)) return null

  if (hour >= 0 && hour < 12) return 'Morning'
  if (hour >= 12 && hour < 18) return 'Evening'
  return 'Night'
}
