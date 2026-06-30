export function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + (minutes ?? 0)
}

export function combineDateAndTime(date: string, time: string): string {
  return `${date}T${time}:00`
}

export function calcLateMinutes(
  checkInTime: string,
  dutyStart: string,
  graceMinutes = 15,
): number {
  if (!checkInTime || !dutyStart) return 0
  const checkIn = parseTimeToMinutes(checkInTime)
  const dutyTotal = parseTimeToMinutes(dutyStart)
  const lateMinutes = checkIn - dutyTotal - graceMinutes
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

export function statusFromLateMinutes(
  lateMinutes: number,
): 'PRESENT' | 'LATE' | 'HALF_DAY' {
  if (lateMinutes > 60) return 'HALF_DAY'
  if (lateMinutes > 0) return 'LATE'
  return 'PRESENT'
}
