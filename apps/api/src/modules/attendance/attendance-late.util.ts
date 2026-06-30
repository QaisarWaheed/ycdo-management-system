export function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + (minutes ?? 0);
}

export function computeLateMinutesFromCheckIn(
  checkIn: Date,
  dutyStartTime: string,
  graceMinutes = 15,
): number {
  const checkInMinutes = checkIn.getHours() * 60 + checkIn.getMinutes();
  const dutyStart = parseTimeToMinutes(dutyStartTime);
  const late = checkInMinutes - dutyStart - graceMinutes;
  return late > 0 ? late : 0;
}

export function resolveDutyStartTime(employee: {
  dutyStartTime?: string | null;
  shift?: { startTime: string } | null;
}): string | null {
  return employee.dutyStartTime ?? employee.shift?.startTime ?? null;
}
