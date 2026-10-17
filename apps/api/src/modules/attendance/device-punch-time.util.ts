import { parseAttendanceDateTime } from './attendance-late.util';

/** A punch whose clock error is this far from the device's usual error is an offline dump. */
export const CLOCK_OFFSET_TOLERANCE_MS = 30 * 60 * 1000;

/** A new clock error must repeat this long after first seen before we trust it. */
export const CLOCK_RESET_CONFIRM_MS = 10 * 60 * 1000;

/** Two punches on a re-set clock share the same error within this slack. */
const CLOCK_RESET_MATCH_MS = 2 * 60 * 1000;

/** Gateway receive time older than this is not trusted as the punch moment. */
const MAX_RECEIVED_TIME_AGE_MS = 24 * 60 * 60 * 1000;

/** Gateway clock slightly ahead of the API is fine; more is ignored. */
const MAX_RECEIVED_TIME_FUTURE_MS = 60 * 1000;

/** Burst replay stamps check-in and check-out on the same second. */
export const MIN_BIOMETRIC_SESSION_MS = 2 * 60 * 1000;

/** An offline dump older than this is not auto-saved. */
export const MAX_DELAYED_PUNCH_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** A device sending this many events in the last minute is replaying its memory. */
export const DUMP_BURST_MIN_EVENTS = 3;
export const DUMP_BURST_WINDOW_MS = 60 * 1000;

export const PUNCH_REVIEW_REASON =
  'Needs HR review: device clock changed or unknown';
export const CHECKOUT_TOO_SOON_REASON = 'CHECKOUT_TOO_SOON';

/**
 * ok: live punch at receive time. delayed: offline dump replayed on a known,
 * unchanged clock — saved at its real time. review: clock changed/unknown,
 * not saved; HR decides.
 */
export type DevicePunchVerdict = 'ok' | 'delayed' | 'review';

/** What we remember about one device's clock error (receive time − device time). */
export interface DeviceClockState {
  clockOffsetSec: number | null;
  clockCandidateSec: number | null;
  clockCandidateAt: Date | null;
}

function parseDeviceTime(raw: string): Date | null {
  const parsed = parseAttendanceDateTime(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Gateway receive time when sane, else API now. */
function resolveReceiveTime(
  receivedTime: string | null | undefined,
  now: Date,
): Date {
  if (!receivedTime) return now;
  const parsed = new Date(receivedTime);
  if (Number.isNaN(parsed.getTime())) return now;
  const age = now.getTime() - parsed.getTime();
  if (age > MAX_RECEIVED_TIME_AGE_MS || age < -MAX_RECEIVED_TIME_FUTURE_MS) {
    return now;
  }
  return parsed;
}

function learned(offsetMs: number): DeviceClockState {
  return {
    clockOffsetSec: Math.round(offsetMs / 1000),
    clockCandidateSec: null,
    clockCandidateAt: null,
  };
}

/**
 * Punch time is always Pakistan time at receipt (gateway receive time, else
 * API now), never the device clock. A device may run hours slow/fast, in a
 * China +08:00 zone, or in a factory year — its punches still land at the
 * real moment.
 *
 * The device clock is only used to catch offline dumps: each device's clock
 * error is learned from its live punches. A punch whose error is far from
 * that happened before it reached us: when it arrives in a burst (the device
 * replaying its memory, ≥3 events in the last minute) and is at most 7 days
 * old, it is saved at its real time (device time + learned error). Any other
 * mismatch goes to HR review. If a clock is re-set, the new error is trusted
 * once it repeats on a punch at least 10 minutes later (immediately when the
 * clock becomes correct).
 */
export function resolveDevicePunch(opts: {
  eventTime?: string | null;
  timestamp?: string | null;
  receivedTime?: string | null;
  now?: Date;
  clock?: DeviceClockState | null;
  /** Events this device sent in the last minute (offline-dump burst signal). */
  recentDeviceEvents?: number;
}): {
  checkTime: Date;
  verdict: DevicePunchVerdict;
  /** Parsed device clock reading, or null when absent/unparseable. */
  deviceTime: Date | null;
  /** New clock state to persist, or null when nothing changed. */
  nextClock: DeviceClockState | null;
} {
  const now = opts.now ?? new Date();
  const checkTime = resolveReceiveTime(opts.receivedTime, now);
  const raw = (opts.eventTime ?? opts.timestamp ?? '').trim();
  const deviceTime = raw ? parseDeviceTime(raw) : null;
  if (!deviceTime) {
    return { checkTime, verdict: 'ok', deviceTime: null, nextClock: null };
  }

  const offsetMs = checkTime.getTime() - deviceTime.getTime();
  const accept = () => ({
    checkTime,
    verdict: 'ok' as const,
    deviceTime,
    nextClock: learned(offsetMs),
  });

  const baselineSec = opts.clock?.clockOffsetSec ?? null;
  // Correct clock, or first punch we see from this device.
  if (Math.abs(offsetMs) <= CLOCK_OFFSET_TOLERANCE_MS || baselineSec == null) {
    return accept();
  }
  if (Math.abs(offsetMs - baselineSec * 1000) <= CLOCK_OFFSET_TOLERANCE_MS) {
    return accept();
  }

  const candidateSec = opts.clock?.clockCandidateSec ?? null;
  const candidateAt = opts.clock?.clockCandidateAt ?? null;
  const matchesCandidate =
    candidateSec != null &&
    candidateAt != null &&
    Math.abs(offsetMs - candidateSec * 1000) <= CLOCK_RESET_MATCH_MS;
  if (
    matchesCandidate &&
    checkTime.getTime() - candidateAt.getTime() >= CLOCK_RESET_CONFIRM_MS
  ) {
    return accept();
  }

  // ponytail: a clock set back during a busy burst looks like a dump and is
  // saved early; HR can fix it. Add a per-device "clock changed" flag if seen.
  const correctedMs = deviceTime.getTime() + baselineSec * 1000;
  const delayMs = checkTime.getTime() - correctedMs;
  if (
    delayMs > CLOCK_OFFSET_TOLERANCE_MS &&
    delayMs <= MAX_DELAYED_PUNCH_AGE_MS &&
    (opts.recentDeviceEvents ?? 0) >= DUMP_BURST_MIN_EVENTS
  ) {
    return {
      checkTime: new Date(correctedMs),
      verdict: 'delayed',
      deviceTime,
      nextClock: null,
    };
  }

  if (matchesCandidate) {
    return { checkTime, verdict: 'review', deviceTime, nextClock: null };
  }
  return {
    checkTime,
    verdict: 'review',
    deviceTime,
    nextClock: {
      clockOffsetSec: baselineSec,
      clockCandidateSec: Math.round(offsetMs / 1000),
      clockCandidateAt: checkTime,
    },
  };
}

export function devicePunchRejectReason(
  verdict: DevicePunchVerdict,
): string | null {
  return verdict === 'review' ? PUNCH_REVIEW_REASON : null;
}

export function isCheckoutTooSoon(
  checkIn: Date | null | undefined,
  checkOut: Date,
): boolean {
  if (!checkIn) return false;
  return checkOut.getTime() - checkIn.getTime() < MIN_BIOMETRIC_SESSION_MS;
}
