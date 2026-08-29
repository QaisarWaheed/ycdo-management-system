import {
  daysInPayrollMonth,
  prorateContractualBasicForPayrollSegment,
} from './stipend.util';

describe('prorateContractualBasicForPayrollSegment', () => {
  const august2026 = {
    year: 2026,
    month: 8,
    monthEnd: new Date(Date.UTC(2026, 7, 31, 23, 59, 59, 999)),
  };

  it('returns the full monthly stipend when the segment covers all 31 August days', () => {
    expect(
      prorateContractualBasicForPayrollSegment({
        contractualBasic: 100000,
        ...august2026,
        segmentStart: new Date(Date.UTC(2026, 7, 1)),
        segmentEndExclusive: null,
      }),
    ).toBe(100000);
  });

  it('prorates mid-month package start by calendar days, not attendance', () => {
    // Aug 15–31 = 17 days
    expect(
      prorateContractualBasicForPayrollSegment({
        contractualBasic: 100000,
        ...august2026,
        segmentStart: new Date(Date.UTC(2026, 7, 15)),
        segmentEndExclusive: null,
      }),
    ).toBe(54838.71);
  });

  it('prorates mid-month joining even when stipend effectiveFrom is before the month', () => {
    expect(
      prorateContractualBasicForPayrollSegment({
        contractualBasic: 100000,
        ...august2026,
        segmentStart: new Date(Date.UTC(2026, 7, 1)),
        segmentEndExclusive: null,
        employmentStart: new Date(Date.UTC(2026, 7, 15)),
      }),
    ).toBe(54838.71);
  });

  it('prorates a closed segment ending Aug 15 exclusive as Aug 1–14', () => {
    expect(
      prorateContractualBasicForPayrollSegment({
        contractualBasic: 24800,
        ...august2026,
        segmentStart: new Date(Date.UTC(2026, 7, 1)),
        segmentEndExclusive: new Date(Date.UTC(2026, 7, 15)),
      }),
    ).toBe(11200); // 24800 * 14 / 31
  });

  it('uses 31 calendar days for August 2026', () => {
    expect(daysInPayrollMonth(2026, 8)).toBe(31);
  });
});
