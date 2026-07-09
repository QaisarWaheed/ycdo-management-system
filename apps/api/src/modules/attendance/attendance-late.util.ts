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

/** Parse attendance datetimes; naive strings are treated as Pakistan local time */
export function parseAttendanceDateTime(iso: string): Date {
  if (/[Zz]$/.test(iso) || /[+-]\d{2}:\d{2}$/.test(iso)) {
    return new Date(iso);
  }
  return new Date(`${iso}+05:00`);
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

export function resolveDutyEndTime(employee: {
  dutyEndTime?: string | null;
  shift?: { endTime: string } | null;
}): string | null {
  return employee.dutyEndTime ?? employee.shift?.endTime ?? null;
}

export function isWithinDutyWindow(
  currentMinutes: number,
  startTime: string,
  endTime: string,
): boolean {
  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);

  if (startMin === endMin) {
    return true;
  }

  if (endMin < startMin) {
    return currentMinutes >= startMin || currentMinutes <= endMin;
  }

  return currentMinutes >= startMin && currentMinutes <= endMin;
}
