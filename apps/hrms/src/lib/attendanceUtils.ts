export function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + (minutes ?? 0)
}

export function combineDateAndTime(date: string, time: string): string {
  return `${date}T${time}:00`
}

export function calcLateMinutes(
  checkInTime: string,
  shiftStart: string,
  graceMinutes = 15,
): number {
  const checkIn = parseTimeToMinutes(checkInTime)
  const graceEnd = parseTimeToMinutes(shiftStart) + graceMinutes
  if (checkIn <= graceEnd) return 0
  return checkIn - graceEnd
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
