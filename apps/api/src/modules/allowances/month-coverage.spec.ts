import { AllowanceProration } from '@prisma/client';
import { computePackageAllowanceLines, monthCoverage } from './package-allowances.util';

const OCT = 2026 * 12 + 10;

describe('Req 4 calendar-day pro-rata', () => {
  it('first month from startDay, last month to endDay, whole months in between', () => {
    const r = { startKey: OCT, startDay: 16, endKey: OCT + 2, endDay: 10 };
    expect(monthCoverage(r, 2026, 10)).toBeCloseTo(16 / 31);
    expect(monthCoverage(r, 2026, 11)).toBe(1);
    expect(monthCoverage(r, 2026, 12)).toBeCloseTo(10 / 31);
    expect(monthCoverage(r, 2027, 1)).toBe(0);
    expect(monthCoverage({ startKey: OCT }, 2026, 10)).toBe(1);
    expect(monthCoverage({ startKey: OCT, startDay: 16, endKey: OCT, endDay: 20 }, 2026, 10)).toBeCloseTo(5 / 31);
  });

  it('a mid-month allowance pays its calendar days (3000 from 16 Oct = 1548)', () => {
    const { lines } = computePackageAllowanceLines(
      [
        { name: 'Admin', proration: AllowanceProration.FULL_MONTH, amount: 3000, coverage: 16 / 31 },
        { name: 'Petrol', proration: AllowanceProration.FULL_MONTH, amount: 2000 },
      ],
      { prorate: (n) => n, paidDays: 31, calendarDays: 31 },
    );
    expect(lines).toEqual(
      expect.arrayContaining([
        { label: 'Admin', amount: 1548 },
        { label: 'Petrol', amount: 2000 },
      ]),
    );
  });
});
