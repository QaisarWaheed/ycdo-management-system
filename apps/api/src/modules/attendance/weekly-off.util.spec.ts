import {
  isWeeklyOffDate,
  normalizeWeeklyOffWeekdays,
} from './weekly-off.util';

/** Pakistan date-only UTC midnight: 4 Sep 2026 is Friday, 6 Sep is Sunday. */
const FRI = new Date(Date.UTC(2026, 8, 4));
const SAT = new Date(Date.UTC(2026, 8, 5));
const SUN = new Date(Date.UTC(2026, 8, 6));

describe('normalizeWeeklyOffWeekdays', () => {
  it('treats missing as no weekly off', () => {
    expect(normalizeWeeklyOffWeekdays(undefined)).toEqual([]);
    expect(normalizeWeeklyOffWeekdays(null)).toEqual([]);
    expect(normalizeWeeklyOffWeekdays([])).toEqual([]);
  });

  it('sorts and dedupes', () => {
    expect(normalizeWeeklyOffWeekdays([5, 0, 5])).toEqual([0, 5]);
  });

  it('rejects values outside 0–6', () => {
    expect(() => normalizeWeeklyOffWeekdays([7])).toThrow(/0–6/);
    expect(() => normalizeWeeklyOffWeekdays([-1])).toThrow(/0–6/);
    expect(() => normalizeWeeklyOffWeekdays([1.5])).toThrow(/0–6/);
  });
});

describe('isWeeklyOffDate', () => {
  it('is false when the list is empty', () => {
    expect(isWeeklyOffDate([], FRI)).toBe(false);
    expect(isWeeklyOffDate(undefined, SUN)).toBe(false);
  });

  it('skips Friday when 5 is ticked, not Saturday', () => {
    expect(isWeeklyOffDate([5], FRI)).toBe(true);
    expect(isWeeklyOffDate([5], SAT)).toBe(false);
  });

  it('skips Sunday when 0 is ticked', () => {
    expect(isWeeklyOffDate([0], SUN)).toBe(true);
    expect(isWeeklyOffDate([0], FRI)).toBe(false);
  });
});
