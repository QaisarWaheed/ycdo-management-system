import type { Shift } from '@/types'

export function formatShiftStartTime(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const period = h < 12 ? 'AM' : 'PM'
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

export function getUniqueShiftStartTimes(shifts: Pick<Shift, 'startTime'>[]): string[] {
  return [...new Set(shifts.map((s) => s.startTime))].sort()
}

export function getShiftIdsForStartTime(
  shifts: Pick<Shift, 'id' | 'startTime'>[],
  startTime: string,
): string {
  return shifts
    .filter((s) => s.startTime === startTime)
    .map((s) => s.id)
    .join(',')
}

export function shiftStartTimeFilterLabel(startTime: string): string {
  return `${formatShiftStartTime(startTime)} shifts`
}
