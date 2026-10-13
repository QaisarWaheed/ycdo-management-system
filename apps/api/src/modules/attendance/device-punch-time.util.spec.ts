import {
  CHECKOUT_TOO_SOON_REASON,
  DeviceClockState,
  STALE_DEVICE_EVENT_REASON,
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

  it('rejects an offline dump from a correct-clock device', () => {
    const result = resolveDevicePunch({
      eventTime: '2026-08-30T05:00:00+05:00',
      now,
      clock: { clockOffsetSec: 3, clockCandidateSec: null, clockCandidateAt: null },
    });
    expect(result.verdict).toBe('stale');
    expect(devicePunchRejectReason(result.verdict)).toBe(
      STALE_DEVICE_EVENT_REASON,
    );
  });

  it('rejects an offline dump from a slow-clock device', () => {
    // Device 2.5h slow; punch was really at 06:00 PKT, uploaded at 08:00.
    const result = resolveDevicePunch({
      eventTime: '2026-08-30T03:30:00',
      now,
      clock: slowClock,
    });
    expect(result.verdict).toBe('stale');
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
    expect(first.verdict).toBe('stale');

    const soon = resolveDevicePunch({
      eventTime: '2026-08-30T04:05:00',
      now: new Date(now.getTime() + 5 * 60 * 1000),
      clock: first.nextClock,
    });
    expect(soon.verdict).toBe('stale');

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
