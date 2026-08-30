import {
  parseAttendanceDateTime,
  toPakistanMinutesOfDay,
} from './attendance-late.util';

/** Offline device dumps older than this must never write attendance. */
export const MAX_DEVICE_PUNCH_AGE_MS = 30 * 60 * 1000;

/** Device clock slightly ahead of the API is normal; more than this is garbage. */
export const MAX_DEVICE_PUNCH_FUTURE_MS = 5 * 60 * 1000;

/** Calendar that far off is a broken device year, not an offline dump. */
export const BAD_DEVICE_CALENDAR_MS = 24 * 60 * 60 * 1000;

/** Clock-of-day slack when the device year/date is nonsense. */
const CLOCK_OF_DAY_SLACK_MINUTES = 30;

/** Burst replay stamps check-in and check-out on the same second. */
export const MIN_BIOMETRIC_SESSION_MS = 2 * 60 * 1000;

export const STALE_DEVICE_EVENT_REASON = 'STALE_DEVICE_EVENT';
export const FUTURE_DEVICE_EVENT_REASON = 'FUTURE_DEVICE_EVENT';
export const INVALID_DEVICE_EVENT_TIME_REASON = 'INVALID_DEVICE_EVENT_TIME';
export const CHECKOUT_TOO_SOON_REASON = 'CHECKOUT_TOO_SOON';

export type DevicePunchVerdict = 'ok' | 'stale' | 'future' | 'invalid';

export function classifyDevicePunchAge(
  checkTime: Date,
  now: Date = new Date(),
): DevicePunchVerdict {
  if (Number.isNaN(checkTime.getTime())) return 'invalid';
  const delta = now.getTime() - checkTime.getTime();
  if (delta > MAX_DEVICE_PUNCH_AGE_MS) return 'stale';
  if (delta < -MAX_DEVICE_PUNCH_FUTURE_MS) return 'future';
  return 'ok';
}

export function devicePunchRejectReason(
  verdict: DevicePunchVerdict,
): string | null {
  if (verdict === 'stale') return STALE_DEVICE_EVENT_REASON;
  if (verdict === 'future') return FUTURE_DEVICE_EVENT_REASON;
  if (verdict === 'invalid') return INVALID_DEVICE_EVENT_TIME_REASON;
  return null;
}

function pakistanWallClock(raw: string): Date | null {
  const match = raw
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = parseAttendanceDateTime(match[1].replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clockOfDayClose(a: Date, b: Date): boolean {
  const diff = Math.abs(toPakistanMinutesOfDay(a) - toPakistanMinutesOfDay(b));
  return Math.min(diff, 24 * 60 - diff) <= CLOCK_OF_DAY_SLACK_MINUTES;
}

function salvageWrongCalendar(
  candidate: Date,
  now: Date,
): { checkTime: Date; fromDevice: boolean; verdict: DevicePunchVerdict } | null {
  const age = Math.abs(now.getTime() - candidate.getTime());
  if (age <= BAD_DEVICE_CALENDAR_MS) return null;
  if (!clockOfDayClose(candidate, now)) return null;
  return { checkTime: now, fromDevice: false, verdict: 'ok' };
}

/**
 * Prefer the device's punch clock when the gateway/agent sent one.
 * Falls back to API receive time only when no device time was provided
 * (live biometric-push / broken firmware).
 *
 * Hikvision terminals often ship with China +08:00, or a factory year
 * (2016) while the wall clock is Pakistan local. Treat those as live
 * punches. Same-day offline dumps (30 min–24 h old) stay rejected.
 */
export function resolveRawScanPunchTime(opts: {
  eventTime?: string | null;
  timestamp?: string | null;
  now?: Date;
}): { checkTime: Date; fromDevice: boolean; verdict: DevicePunchVerdict } {
  const now = opts.now ?? new Date();
  const raw = (opts.eventTime ?? opts.timestamp ?? '').trim();
  if (!raw) {
    return { checkTime: now, fromDevice: false, verdict: 'ok' };
  }

  const parsed = parseAttendanceDateTime(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { checkTime: now, fromDevice: true, verdict: 'invalid' };
  }

  if (classifyDevicePunchAge(parsed, now) === 'ok') {
    return { checkTime: parsed, fromDevice: true, verdict: 'ok' };
  }

  const pktWall = pakistanWallClock(raw);
  if (pktWall && classifyDevicePunchAge(pktWall, now) === 'ok') {
    return { checkTime: pktWall, fromDevice: true, verdict: 'ok' };
  }

  const salvaged =
    salvageWrongCalendar(parsed, now) ??
    (pktWall ? salvageWrongCalendar(pktWall, now) : null);
  if (salvaged) return salvaged;

  return {
    checkTime: parsed,
    fromDevice: true,
    verdict: classifyDevicePunchAge(parsed, now),
  };
}

export function isCheckoutTooSoon(
  checkIn: Date | null | undefined,
  checkOut: Date,
): boolean {
  if (!checkIn) return false;
  return checkOut.getTime() - checkIn.getTime() < MIN_BIOMETRIC_SESSION_MS;
}
