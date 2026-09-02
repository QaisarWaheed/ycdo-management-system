import {
  countsTowardSuspensionWatch,
  suspensionInquiryReinstatementData,
} from './suspension-watch-baseline.util';
import { EmployeeStatus } from '@prisma/client';

describe('countsTowardSuspensionWatch', () => {
  const baseline = new Date(Date.UTC(2026, 7, 15));

  it('counts days on or after the baseline', () => {
    expect(
      countsTowardSuspensionWatch(new Date(Date.UTC(2026, 7, 15)), baseline),
    ).toBe(true);
    expect(
      countsTowardSuspensionWatch(new Date(Date.UTC(2026, 7, 20)), baseline),
    ).toBe(true);
  });

  it('ignores days before the baseline', () => {
    expect(
      countsTowardSuspensionWatch(new Date(Date.UTC(2026, 7, 14)), baseline),
    ).toBe(false);
  });

  it('counts every day when baseline is null', () => {
    expect(
      countsTowardSuspensionWatch(new Date(Date.UTC(2026, 7, 1)), null),
    ).toBe(true);
  });
});

describe('suspensionInquiryReinstatementData', () => {
  it('reactivates and sets the Pakistan-date baseline only', () => {
    const now = new Date('2026-08-20T10:00:00+05:00');
    const data = suspensionInquiryReinstatementData(now);
    expect(data.status).toBe(EmployeeStatus.ACTIVE);
    expect(data.statusEffectiveFrom).toBeNull();
    expect(data.suspensionWatchBaselineOn).toEqual(
      new Date(Date.UTC(2026, 7, 20)),
    );
  });
});
