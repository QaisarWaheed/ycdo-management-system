jest.mock('./discipline.helper', () => ({
  reverseLateDisciplineForDate: jest.fn(),
}));

import { evaluateShortLeaveDeviation } from './short-leave.util';

const twelveHourDuty = {
  dutyStartTime: '08:00',
  dutyEndTime: '20:00',
  dutyTotalHours: 12,
  shift: null,
};

describe('evaluateShortLeaveDeviation', () => {
  const logDate = new Date('2026-08-27T00:00:00.000Z');

  it('allows short leave when 10 min late is within grace and checkout is 30 min early', () => {
    const result = evaluateShortLeaveDeviation(
      twelveHourDuty,
      logDate,
      new Date('2026-08-27T08:10:00+05:00'),
      new Date('2026-08-27T19:30:00+05:00'),
    );

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.side).toBe('EARLY');
      expect(result.deviationMinutes).toBe(30);
    }
  });

  it('allows late plus early when the combined minutes stay within the 3-hour allowance', () => {
    const result = evaluateShortLeaveDeviation(
      twelveHourDuty,
      logDate,
      new Date('2026-08-27T08:40:00+05:00'),
      new Date('2026-08-27T19:00:00+05:00'),
    );

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.deviationMinutes).toBe(25 + 60);
    }
  });

  it('rejects when combined late and early exceed the allowance', () => {
    const result = evaluateShortLeaveDeviation(
      twelveHourDuty,
      logDate,
      new Date('2026-08-27T10:00:00+05:00'),
      new Date('2026-08-27T16:00:00+05:00'),
    );

    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.reason).toMatch(/exceeds the allowed 180-minute/);
    }
  });
});
