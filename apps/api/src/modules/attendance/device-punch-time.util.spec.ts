import {
  CHECKOUT_TOO_SOON_REASON,
  DeviceClockState,
  PUNCH_REVIEW_REASON,
  STALE_PUNCH_REASON,
  devicePunchRejectReason,
  isCheckoutTooSoon,
  resolveDevicePunch,
} from './device-punch-time.util';

const now = new Date('2026-08-30T08:00:00+05:00');
const HOUR = 60 * 60;

const slowClock: DeviceClockState = {
  clockOffsetSec: 2.5 * HOUR,
  clockCandidateSec: null,
  clockCandidateAt: null,
};

const correctClock: DeviceClockState = {
  clockOffsetSec: 3,
  clockCandidateSec: null,
  clockCandidateAt: null,
};

describe('device-punch-time.util', () => {
  it('uses API time when the device sent no punch clock', () => {
    const result = resolveDevicePunch({ now });
    expect(result.verdict).toBe('ok');
    expect(result.checkTime).toEqual(now);
    expect(result.nextClock).toBeNull();
  });

  it('stores 08:00 PKT when the device clock shows 05:30 (first punch)', () => {
    const result = resolveDevicePunch({
      eventTime: '2026-08-30T05:30:00',
      now,
    });
    expect(result.verdict).toBe('ok');
    expect(result.checkTime).toEqual(now);
    expect(result.nextClock?.clockOffsetSec).toBe(2.5 * HOUR);
  });

  it('keeps accepting a device that is consistently 2.5h slow', () => {
    const result = resolveDevicePunch({
      eventTime: '2026-08-30T05:31:00',
      now,
      clock: slowClock,
    });
    expect(result.verdict).toBe('ok');
    expect(result.checkTime).toEqual(now);
  });

  it('stores receive time for a correct clock, not the device seconds', () => {
    const result = resolveDevicePunch({
      eventTime: '2026-08-30T07:58:00+05:00',
      now,
    });
    expect(result.checkTime).toEqual(now);
    expect(result.verdict).toBe('ok');
  });

  it('sends an isolated old punch from a correct-clock device to HR review', () => {
    const result = resolveDevicePunch({
      eventTime: '2026-08-30T07:00:00+05:00',
      now,
      clock: { clockOffsetSec: 3, clockCandidateSec: null, clockCandidateAt: null },
    });
    expect(result.verdict).toBe('review');
    expect(devicePunchRejectReason(result.verdict)).toBe(PUNCH_REVIEW_REASON);
    expect(result.deviceTime).toEqual(new Date('2026-08-30T07:00:00+05:00'));
  });

  it('sends an isolated old punch from a slow-clock device to HR review', () => {
    // Device 2.5h slow; punch was really at 06:00 PKT, uploaded at 08:00.
    const result = resolveDevicePunch({
      eventTime: '2026-08-30T03:30:00',
      now,
      clock: slowClock,
    });
    expect(result.verdict).toBe('review');
  });

  it('saves an offline dump on a known slow clock at its real time', () => {
    // Device 2.5h slow; punch really at 06:00 PKT, replayed at 08:00 in a burst.
    const result = resolveDevicePunch({
      eventTime: '2026-08-30T03:30:00',
      now,
      clock: slowClock,
      recentDeviceEvents: 5,
    });
    expect(result.verdict).toBe('delayed');
    expect(result.checkTime).toEqual(new Date('2026-08-30T06:00:00+05:00'));
    expect(result.nextClock?.clockOffsetSec ?? 2.5 * HOUR).toBe(2.5 * HOUR);
    expect(devicePunchRejectReason(result.verdict)).toBeNull();
  });

  it('saves a dump from an hour ago on a correct clock at its real time', () => {
    const punched = new Date('2026-08-30T07:00:00+05:00');
    const result = resolveDevicePunch({
      eventTime: '2026-08-30T07:00:00+05:00',
      now,
      clock: correctClock,
      recentDeviceEvents: 3,
    });
    expect(result.verdict).toBe('delayed');
    expect(result.checkTime).toEqual(new Date(punched.getTime() + 3000));
  });

  it('drops a punch that reached us more than 2 h late as stale', () => {
    for (const eventTime of ['2026-08-29T21:15:00+05:00', '2026-08-20T09:00:00+05:00']) {
      const result = resolveDevicePunch({
        eventTime,
        now,
        clock: correctClock,
        recentDeviceEvents: 10,
      });
      expect(result.verdict).toBe('stale');
      expect(devicePunchRejectReason(result.verdict)).toBe(STALE_PUNCH_REASON);
    }
  });

  it('saves a punch delayed a few minutes at its device time, without a burst', () => {
    // Device 4 min fast (error -253 s); punched 08:09:22, delivered 08:20:00.
    const result = resolveDevicePunch({
      eventTime: '2026-10-19T08:09:22+05:00',
      receivedTime: '2026-10-19T08:20:00+05:00',
      now: new Date('2026-10-19T08:20:01+05:00'),
      clock: { clockOffsetSec: -253, clockCandidateSec: null, clockCandidateAt: null },
    });
    expect(result.verdict).toBe('delayed');
    expect(result.checkTime).toEqual(new Date('2026-10-19T08:05:09+05:00'));
  });

  it('does not chain-learn a draining backlog as the clock error (Masoom Shah 19 Oct)', () => {
    // Baseline wrongly learned from a punch that was itself 14 min late.
    let clock: DeviceClockState = { clockOffsetSec: 835, clockCandidateSec: null, clockCandidateAt: null };
    const dump = [
      ['2026-10-19T08:00:53+05:00', '2026-10-19T08:49:52+05:00'],
      ['2026-10-19T08:09:22+05:00', '2026-10-19T08:50:04+05:00'],
      ['2026-10-19T08:28:26+05:00', '2026-10-19T08:50:19+05:00'],
    ];
    for (const [eventTime, receivedTime] of dump) {
      const result = resolveDevicePunch({
        eventTime,
        receivedTime,
        now: new Date(receivedTime),
        clock,
        recentDeviceEvents: 10,
      });
      expect(result.verdict).toBe('delayed');
      // Never stamped at the dump moment.
      expect(result.checkTime.getTime()).toBeLessThan(new Date(receivedTime).getTime() - 2 * 60 * 1000);
      clock = { ...clock, ...(result.nextClock ?? {}) };
      expect(clock.clockOffsetSec).toBe(835);
    }
    // A punch less late than the wrong baseline lowers it (cannot tell better).
    const lessLate = resolveDevicePunch({
      eventTime: '2026-10-19T08:45:06+05:00',
      receivedTime: '2026-10-19T08:50:22+05:00',
      now: new Date('2026-10-19T08:50:22+05:00'),
      clock,
      recentDeviceEvents: 10,
    });
    expect(lessLate.verdict).toBe('ok');
    expect(lessLate.nextClock?.clockOffsetSec).toBe(316);
    clock = { ...clock, ...lessLate.nextClock };
    // First live punch (device 4 min fast) lowers the baseline to the real error.
    const live = resolveDevicePunch({
      eventTime: '2026-10-19T09:04:40+05:00',
      receivedTime: '2026-10-19T09:00:25+05:00',
      now: new Date('2026-10-19T09:00:26+05:00'),
      clock,
    });
    expect(live.verdict).toBe('ok');
    expect(live.nextClock?.clockOffsetSec).toBe(-255);
  });

  it('sends a clock set forward to HR review even in a burst', () => {
    const result = resolveDevicePunch({
      eventTime: '2026-08-30T12:00:00+05:00',
      now,
      clock: correctClock,
      recentDeviceEvents: 10,
    });
    expect(result.verdict).toBe('review');
    expect(result.nextClock?.clockCandidateSec).toBe(-4 * HOUR);
  });

  it('accepts immediately once a slow clock is corrected', () => {
    const result = resolveDevicePunch({
      eventTime: '2026-08-30T08:00:05+05:00',
      now,
      clock: slowClock,
    });
    expect(result.verdict).toBe('ok');
    expect(result.nextClock?.clockOffsetSec).toBe(-5);
  });

  it('trusts a re-set wrong clock once the new error repeats 10+ minutes later', () => {
    const first = resolveDevicePunch({
      eventTime: '2026-08-30T04:00:00',
      now,
      clock: slowClock,
    });
    expect(first.verdict).toBe('review');

    const soon = resolveDevicePunch({
      eventTime: '2026-08-30T04:05:00',
      now: new Date(now.getTime() + 5 * 60 * 1000),
      clock: first.nextClock,
    });
    expect(soon.verdict).toBe('review');

    const later = resolveDevicePunch({
      eventTime: '2026-08-30T04:15:00',
      now: new Date(now.getTime() + 15 * 60 * 1000),
      clock: first.nextClock,
    });
    expect(later.verdict).toBe('ok');
    expect(later.nextClock?.clockOffsetSec).toBe(4 * HOUR);
  });

  it('accepts China +08:00 and factory-year clocks via the learned error', () => {
    const china = resolveDevicePunch({
      eventTime: '2026-08-30T08:00:00+08:00',
      now,
    });
    expect(china.verdict).toBe('ok');
    const again = resolveDevicePunch({
      eventTime: '2026-08-30T08:30:00+08:00',
      now: new Date(now.getTime() + 30 * 60 * 1000),
      clock: china.nextClock,
    });
    expect(again.verdict).toBe('ok');

    const factory = resolveDevicePunch({
      eventTime: '2016-08-30T08:00:00+05:00',
      now,
    });
    expect(factory.verdict).toBe('ok');
    expect(factory.checkTime).toEqual(now);
  });

  it('uses the gateway receive time for a delivery retried later', () => {
    const received = new Date('2026-08-30T07:20:00+05:00');
    const result = resolveDevicePunch({
      eventTime: '2026-08-30T04:50:00',
      receivedTime: received.toISOString(),
      now,
      clock: slowClock,
    });
    expect(result.verdict).toBe('ok');
    expect(result.checkTime).toEqual(received);
  });

  it('ignores an implausible gateway receive time', () => {
    const result = resolveDevicePunch({
      receivedTime: '2026-08-28T08:00:00+05:00',
      now,
    });
    expect(result.checkTime).toEqual(now);
  });

  it('accepts an unparseable device time at API time', () => {
    const result = resolveDevicePunch({ eventTime: 'garbage', now });
    expect(result.verdict).toBe('ok');
    expect(result.checkTime).toEqual(now);
  });

  it('blocks check-out on the same second as check-in', () => {
    const checkIn = new Date('2026-08-30T13:53:00+05:00');
    const checkOut = new Date('2026-08-30T13:53:00.400+05:00');
    expect(isCheckoutTooSoon(checkIn, checkOut)).toBe(true);
    expect(CHECKOUT_TOO_SOON_REASON).toBe('CHECKOUT_TOO_SOON');
  });

  it('allows a real session longer than two minutes', () => {
    const checkIn = new Date('2026-08-30T08:05:00+05:00');
    const checkOut = new Date('2026-08-30T13:53:00+05:00');
    expect(isCheckoutTooSoon(checkIn, checkOut)).toBe(false);
  });
});
