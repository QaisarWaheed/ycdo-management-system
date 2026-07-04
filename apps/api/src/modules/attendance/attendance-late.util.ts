export function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + (minutes ?? 0);
}

const PK_OFFSET_MS = 5 * 60 * 60 * 1000;

export function toPakistanDateOnly(date: Date): Date {
  const pkDate = new Date(date.getTime() + PK_OFFSET_MS);
  return new Date(
    Date.UTC(pkDate.getUTCFullYear(), pkDate.getUTCMonth(), pkDate.getUTCDate()),
  );
}

export function toPakistanMinutesOfDay(date: Date): number {
  const pkDate = new Date(date.getTime() + PK_OFFSET_MS);
  return pkDate.getUTCHours() * 60 + pkDate.getUTCMinutes();
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
