import { formatDutyDisplay } from '@/lib/dutyTimes'
import { toPakistanTime24 } from '@/lib/timeFormat'

export function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + (minutes ?? 0)
}

export function combineDateAndTime(date: string, time: string): string {
  return `${date}T${time}:00+05:00`
}

export function calcLateMinutes(
  checkInTime: string,
  dutyStart: string,
  graceMinutes = 15,
): number {
  if (!checkInTime || !dutyStart) return 0
  const checkIn = parseTimeToMinutes(checkInTime)
  const dutyTotal = parseTimeToMinutes(dutyStart)
  const overnightStart = 18 * 60

  let minutesSince: number
  if (dutyTotal >= overnightStart) {
    if (checkIn >= dutyTotal) {
      minutesSince = checkIn - dutyTotal
    } else {
      minutesSince = 1440 - dutyTotal + checkIn
    }
  } else {
    minutesSince = checkIn - dutyTotal
  }

  const lateMinutes = minutesSince - graceMinutes
  return lateMinutes > 0 ? lateMinutes : 0
}

export function calcOvertimeMinutes(
  checkOutTime: string,
  shiftEnd: string,
  graceMinutes = 60,
): number {
  const checkOut = parseTimeToMinutes(checkOutTime)
  const threshold = parseTimeToMinutes(shiftEnd) + graceMinutes
  if (checkOut > threshold) return checkOut - threshold
  return 0
}

export function showsTimeFields(status: string): boolean {
  return status === 'PRESENT' || status === 'LATE' || status === 'HALF_DAY'
}

export function getEmployeeDutyStartTime(employee: {
  dutyStartTime?: string | null
  shift?: { startTime?: string } | null
}): string {
  return employee.dutyStartTime ?? employee.shift?.startTime ?? ''
}

export function getEmployeeDutyEndTime(employee: {
  dutyEndTime?: string | null
  shift?: { endTime?: string } | null
}): string {
  return employee.dutyEndTime ?? employee.shift?.endTime ?? ''
}

export function isWithinDutyWindow(
  currentMinutes: number,
  startTime: string,
  endTime: string,
): boolean {
  if (!startTime || !endTime) return false

  const startMin = parseTimeToMinutes(startTime)
  const endMin = parseTimeToMinutes(endTime)

  if (startMin === endMin) {
    return true
  }

  if (endMin < startMin) {
    return currentMinutes >= startMin || currentMinutes <= endMin
  }

  return currentMinutes >= startMin && currentMinutes <= endMin
}

export function getUniqueDutyStartTimes(
  employees: Array<{
    dutyStartTime?: string | null
    shift?: { startTime?: string } | null
  }>,
): string[] {
  return [
    ...new Set(
      employees
        .map((e) => getEmployeeDutyStartTime(e))
        .filter((t): t is string => Boolean(t)),
    ),
  ].sort()
}

export function filterByDutyStartTime<T extends {
  dutyStartTime?: string | null
  shift?: { startTime?: string } | null
}>(items: T[], dutyStartTime: string): T[] {
  if (!dutyStartTime) return items
  return items.filter(
    (item) => getEmployeeDutyStartTime(item) === dutyStartTime,
  )
}

export function formatEmployeeDutyLabel(employee: {
  shift?: { name?: string; startTime?: string; endTime?: string } | null
  dutyStartTime?: string | null
  dutyEndTime?: string | null
}): string {
  const start = getEmployeeDutyStartTime(employee)
  const end = getEmployeeDutyEndTime(employee)
  if (!start || !end) {
    return employee.shift?.name ?? '—'
  }
  const hours = formatDutyDisplay(start, end)
  return employee.shift?.name ? `${employee.shift.name} · ${hours}` : hours
}

export function getLogLateMinutes(log: {
  lateMinutes?: number | null
  checkIn?: string | null
  status?: string
  employee?: {
    dutyStartTime?: string | null
    shift?: { startTime?: string } | null
  } | null
}): number {
  if ((log.lateMinutes ?? 0) > 0) {
    return log.lateMinutes ?? 0
  }

  if (!log.checkIn || !log.employee) {
    return 0
  }

  const dutyStart = getEmployeeDutyStartTime(log.employee)
  if (!dutyStart) {
    return 0
  }

  const checkInTime = toPakistanTime24(log.checkIn)
  return calcLateMinutes(checkInTime, dutyStart)
}

export function statusFromLateMinutes(
  lateMinutes: number,
): 'PRESENT' | 'LATE' | 'HALF_DAY' {
  if (lateMinutes > 60) return 'HALF_DAY'
  if (lateMinutes > 0) return 'LATE'
  return 'PRESENT'
}

const PK_OFFSET_MS = 5 * 60 * 60 * 1000
const OVERNIGHT_SHIFT_START = 18 * 60

export const ATTENDANCE_GRACE_MINUTES = 15

function toPakistanMinutesOfDay(date: Date): number {
  const pkDate = new Date(date.getTime() + PK_OFFSET_MS)
  return pkDate.getUTCHours() * 60 + pkDate.getUTCMinutes()
}

function minutesSinceShiftStart(
  currentMinutes: number,
  shiftStartMinutes: number,
): number {
  if (shiftStartMinutes >= OVERNIGHT_SHIFT_START) {
    if (currentMinutes >= shiftStartMinutes) {
      return currentMinutes - shiftStartMinutes
    }
    return 1440 - shiftStartMinutes + currentMinutes
  }
  return currentMinutes - shiftStartMinutes
}

export function isWithinGrace(
  shiftStart: string,
  graceMins = ATTENDANCE_GRACE_MINUTES,
): boolean {
  if (!shiftStart) return false
  const shiftStartMins = parseTimeToMinutes(shiftStart)
  const nowMins = toPakistanMinutesOfDay(new Date())
  const minutesSince = minutesSinceShiftStart(nowMins, shiftStartMins)
  return minutesSince >= 0 && minutesSince <= graceMins
}

export function graceMinutesRemaining(
  shiftStart: string,
  graceMins = ATTENDANCE_GRACE_MINUTES,
): number {
  if (!shiftStart) return 0
  const shiftStartMins = parseTimeToMinutes(shiftStart)
  const nowMins = toPakistanMinutesOfDay(new Date())
  const minutesSince = minutesSinceShiftStart(nowMins, shiftStartMins)
  if (minutesSince < 0) return graceMins
  return Math.max(0, graceMins - minutesSince)
}
