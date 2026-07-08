import type { Shift } from '@/types'
import { to12Hour } from '@/lib/timeFormat'

export const ALL_SHIFTS_AT_START = '__all_at_start__'

export function formatShiftTime(time: string): string {
  return to12Hour(time)
}

/** @deprecated Use formatShiftTime */
export const formatShiftStartTime = formatShiftTime

export function getUniqueShiftStartTimes(
  shifts: Pick<Shift, 'startTime'>[],
): string[] {
  return [...new Set(shifts.map((s) => s.startTime))].sort()
}

export function getShiftsForStartTime(
  shifts: Pick<Shift, 'id' | 'name' | 'startTime' | 'endTime'>[],
  startTime: string,
) {
  return shifts.filter((s) => s.startTime === startTime)
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

export function formatShiftOptionLabel(
  shift: Pick<Shift, 'name' | 'startTime' | 'endTime'>,
): string {
  return `${shift.name} (${formatShiftTime(shift.startTime)} - ${formatShiftTime(shift.endTime)})`
}

export function allShiftsAtStartLabel(startTime: string): string {
  return `All ${formatShiftTime(startTime)} shifts`
}

export function shiftStartTimeFilterLabel(startTime: string): string {
  return `${formatShiftTime(startTime)} shifts`
}

export function resolveShiftIds(
  shiftStartTime: string,
  shiftId: string,
  shifts: Pick<Shift, 'id' | 'startTime'>[],
): string | undefined {
  if (!shiftStartTime) return undefined
  if (shiftId && shiftId !== ALL_SHIFTS_AT_START) {
    return shiftId
  }
  return getShiftIdsForStartTime(shifts, shiftStartTime) || undefined
}
