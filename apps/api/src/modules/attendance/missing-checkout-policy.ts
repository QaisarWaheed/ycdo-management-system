/**
 * Note stamped by ShiftMissingCheckoutScheduler when it closes an open session
 * at scheduled duty end. The checkOut it writes is not a real punch, so this
 * marker is what keeps the day recognisable as a missed checkout until HR or
 * the employee supplies the real time (which strips the marker).
 */
export const MISSING_CHECKOUT_AUTO_NOTE =
  'Auto checkout at scheduled duty end: missing checkout';

/**
 * Missed checkouts follow the Advice/Warning/Fine cycle (and the payroll
 * "every 3 = 1 day" rule) only from this date. Earlier incidents keep the old
 * warning-only treatment and are never counted, so the new rule is never
 * applied retroactively.
 */
export const MISSING_CHECKOUT_CYCLE_FROM = new Date('2026-10-09T00:00:00.000Z');
