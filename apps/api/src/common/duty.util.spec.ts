import {
  hoursBetweenDutyTimes,
  isValidDutyTotalHours,
  normalizeDutyTotalHours,
} from './duty.util';

describe('duty total hours', () => {
  it('accepts half-hour steps including 6.5', () => {
    expect(isValidDutyTotalHours(6.5)).toBe(true);
    expect(isValidDutyTotalHours(8)).toBe(true);
    expect(isValidDutyTotalHours(24)).toBe(true);
    expect(isValidDutyTotalHours(0.5)).toBe(true);
  });

  it('rejects values outside 0.5–24 or not on a half hour', () => {
    expect(isValidDutyTotalHours(6.25)).toBe(false);
    expect(isValidDutyTotalHours(0)).toBe(false);
    expect(isValidDutyTotalHours(25)).toBe(false);
    expect(isValidDutyTotalHours(6.3)).toBe(false);
  });

  it('computes 6.5 hours from a 08:00–14:30 window', () => {
    expect(hoursBetweenDutyTimes('08:00', '14:30')).toBe(6.5);
    expect(normalizeDutyTotalHours(6.49)).toBe(6.5);
  });
});
