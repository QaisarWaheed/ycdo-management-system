import {
  CHECKOUT_TOO_SOON_REASON,
  STALE_DEVICE_EVENT_REASON,
  classifyDevicePunchAge,
  devicePunchRejectReason,
  isCheckoutTooSoon,
  resolveRawScanPunchTime,
} from './device-punch-time.util';

const now = new Date('2026-08-30T14:30:00+05:00');

describe('device-punch-time.util', () => {
  it('uses API time when the device sent no punch clock', () => {
    const result = resolveRawScanPunchTime({ now });
    expect(result.fromDevice).toBe(false);
    expect(result.verdict).toBe('ok');
    expect(result.checkTime).toEqual(now);
  });

  it('uses eventTime for a punch from a few minutes ago', () => {
    const result = resolveRawScanPunchTime({
      eventTime: '2026-08-30T14:22:00+05:00',
      now,
    });
    expect(result.fromDevice).toBe(true);
    expect(result.verdict).toBe('ok');
    expect(result.checkTime.toISOString()).toBe(
      new Date('2026-08-30T14:22:00+05:00').toISOString(),
    );
  });

  it('prefers eventTime over the gateway timestamp alias', () => {
    const result = resolveRawScanPunchTime({
      eventTime: '2026-08-30T14:22:00+05:00',
      timestamp: '2026-08-30T08:00:00+05:00',
      now,
    });
    expect(result.checkTime.toISOString()).toBe(
      new Date('2026-08-30T14:22:00+05:00').toISOString(),
    );
    expect(result.verdict).toBe('ok');
  });

  it('rejects a 6-hour offline dump as stale', () => {
    const result = resolveRawScanPunchTime({
      timestamp: '2026-08-30T08:05:00+05:00',
      now,
    });
    expect(result.verdict).toBe('stale');
    expect(devicePunchRejectReason(result.verdict)).toBe(
      STALE_DEVICE_EVENT_REASON,
    );
  });

  it('treats naive device times as Pakistan local', () => {
    const result = resolveRawScanPunchTime({
      eventTime: '2026-08-30T14:20:00',
      now,
    });
    expect(result.verdict).toBe('ok');
    expect(result.checkTime.toISOString()).toBe(
      new Date('2026-08-30T14:20:00+05:00').toISOString(),
    );
  });

  it('rejects a punch more than 5 minutes in the future', () => {
    expect(
      classifyDevicePunchAge(new Date('2026-08-30T14:40:00+05:00'), now),
    ).toBe('future');
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
