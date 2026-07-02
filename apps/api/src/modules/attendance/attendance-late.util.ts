export function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + (minutes ?? 0);
}

export function calculateLateMinutes(
  checkInTime: string,
  shiftStartTime: string,
  gracePeriodMinutes = 15,
): number {
  const [ciH, ciM] = checkInTime.split(':').map(Number);
  const [ssH, ssM] = shiftStartTime.split(':').map(Number);

  const checkInTotal = ciH * 60 + ciM;
  const shiftStartTotal = ssH * 60 + ssM;
  const graceThreshold = shiftStartTotal + gracePeriodMinutes;

  if (checkInTotal <= graceThreshold) return 0;

  return checkInTotal - shiftStartTotal;
}

export function computeLateMinutesFromCheckIn(
  checkIn: Date,
  dutyStartTime: string,
  graceMinutes = 15,
): number {
  const checkInTime = `${String(checkIn.getHours()).padStart(2, '0')}:${String(checkIn.getMinutes()).padStart(2, '0')}`;
  return calculateLateMinutes(checkInTime, dutyStartTime, graceMinutes);
}

export function resolveDutyStartTime(employee: {
  dutyStartTime?: string | null;
  shift?: { startTime: string } | null;
}): string | null {
  return employee.dutyStartTime ?? employee.shift?.startTime ?? null;
}
