export function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + (minutes ?? 0);
}

export function calculateLateMinutes(
  checkInTime: string,
  shiftStartTime: string,
  gracePeriodMinutes = 15,
): number {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const checkIn = toMinutes(checkInTime);
  const shiftStart = toMinutes(shiftStartTime);
  const isOvernightShift = shiftStart >= 720;

  let diff: number;

  if (isOvernightShift && checkIn < shiftStart) {
    diff = 1440 - shiftStart + checkIn;
  } else {
    diff = checkIn - shiftStart;
  }

  if (diff <= gracePeriodMinutes) return 0;

  return diff;
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

export function isShiftActiveNow(
  startTime: string,
  endTime: string,
  currentMinutes: number,
): boolean {
  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);
  const isOvernight = endMin < startMin;

  if (isOvernight) {
    return currentMinutes >= startMin || currentMinutes <= endMin;
  }

  return currentMinutes >= startMin && currentMinutes <= endMin;
}
