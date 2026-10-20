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

/** A punch that reached us later than this is stale: not saved, not reviewed. */
export const MAX_DELAYED_PUNCH_AGE_MS = 2 * 60 * 60 * 1000;

/** Network jitter: a punch this much later than the clock baseline is still live. */
export const DELAY_SLACK_MS = 2 * 60 * 1000;

/** A device sending this many events in the last minute is replaying its memory. */
export const DUMP_BURST_MIN_EVENTS = 3;
export const DUMP_BURST_WINDOW_MS = 60 * 1000;

export const PUNCH_REVIEW_REASON =
  'Needs HR review: device clock changed or unknown';
export const STALE_PUNCH_REASON = 'STALE_DEVICE_EVENT';
export const CHECKOUT_TOO_SOON_REASON = 'CHECKOUT_TOO_SOON';

/**
 * ok: live punch at receive time. delayed: reached us late on a known clock —
 * saved at its real time. review: clock changed/unknown, not saved; HR
 * decides. stale: reached us more than 2 h late — dropped.
 */
export type DevicePunchVerdict = 'ok' | 'delayed' | 'review' | 'stale';

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
 * A live punch lands at Pakistan time at receipt (gateway receive time, else
 * API now). A device may run hours slow/fast, in a China +08:00 zone, or in a
 * factory year — its punches still land at the real moment.
 *
 * Each device's clock error (receive − device time) is learned. Delivery
 * delay only ever adds to it, so the baseline only moves DOWN on its own: a
 * punch arriving faster than the baseline (within 30 min) lowers it. A punch
 * more than 2 min slower than the baseline reached us late and is saved at
 * its real time (device time + baseline) — when within 30 min, or in a burst
 * (device replaying its memory, ≥3 events in the last minute). More than 2 h
 * late = stale (dropped). Other mismatches go to HR review. A re-set clock's
 * new error is trusted once it repeats on a punch at least 10 minutes later
 * (immediately when the clock becomes correct).
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
  // First punch we see from this device.
  if (baselineSec == null) return accept();

  // How much later than the baseline this punch reached us (< 0 = sooner).
  const delayMs = offsetMs - baselineSec * 1000;
  if (Math.abs(delayMs) <= DELAY_SLACK_MS) {
    return {
      checkTime,
      verdict: 'ok',
      deviceTime,
      nextClock: delayMs < 0 ? learned(offsetMs) : null,
    };
  }
  // Arrived sooner than the baseline: the baseline carried a delivery delay
  // (or the clock became correct) — learn the smaller error.
  if (
    (delayMs < 0 && -delayMs <= CLOCK_OFFSET_TOLERANCE_MS) ||
    Math.abs(offsetMs) <= DELAY_SLACK_MS
  ) {
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
  // Remember this error so a re-set clock is confirmed by its next punch.
  const withCandidate: DeviceClockState | null = matchesCandidate
    ? null
    : {
        clockOffsetSec: baselineSec,
        clockCandidateSec: Math.round(offsetMs / 1000),
        clockCandidateAt: checkTime,
      };

  // ponytail: a clock set back looks like a delay and is saved early until
  // the reset is confirmed 10 min later; HR can fix those few punches.
  if (delayMs > MAX_DELAYED_PUNCH_AGE_MS) {
    return {
      checkTime,
      verdict: 'stale',
      deviceTime,
      nextClock: withCandidate,
    };
  }
  if (
    delayMs > 0 &&
    (delayMs <= CLOCK_OFFSET_TOLERANCE_MS ||
      (opts.recentDeviceEvents ?? 0) >= DUMP_BURST_MIN_EVENTS)
  ) {
    return {
      checkTime: new Date(deviceTime.getTime() + baselineSec * 1000),
      verdict: 'delayed',
      deviceTime,
      nextClock: withCandidate,
    };
  }
  return { checkTime, verdict: 'review', deviceTime, nextClock: withCandidate };
}

export function devicePunchRejectReason(
  verdict: DevicePunchVerdict,
): string | null {
  if (verdict === 'review') return PUNCH_REVIEW_REASON;
  if (verdict === 'stale') return STALE_PUNCH_REASON;
  return null;
}

export function isCheckoutTooSoon(
  checkIn: Date | null | undefined,
  checkOut: Date,
): boolean {
  if (!checkIn) return false;
  return checkOut.getTime() - checkIn.getTime() < MIN_BIOMETRIC_SESSION_MS;
}
