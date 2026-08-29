import { LetterStatus, LetterType } from '@prisma/client';
import {
  buildEligibilityViolationRows,
  issueDueSuspensionEligibilityNotices,
} from './suspension-eligibility-notice';
import type { SuspensionWatchlistEntry } from './suspension-watchlist';

function dueEntry(
  overrides: Partial<SuspensionWatchlistEntry>,
): SuspensionWatchlistEntry {
  return {
    employeeId: 'emp-due',
    fullName: 'Due Late',
    employeeCode: 'D1',
    biometricId: null,
    phone: null,
    branchId: null,
    branchName: null,
    lateDays: 9,
    uninformedAbsentDays: 0,
    lateDates: [
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
    ],
    uninformedAbsentDates: [],
    reasons: ['LATE_DUE'],
    ...overrides,
  };
}

describe('buildEligibilityViolationRows', () => {
  it('includes only Due-contributing categories and omits empty ones', () => {
    const lateOnly = buildEligibilityViolationRows(
      dueEntry({}),
      '2026-08',
    );
    expect(lateOnly).toHaveLength(1);
    expect(lateOnly[0].nameUr).toBe('تاخیر از حاضری');
    expect(lateOnly[0].count).toBe(9);
    expect(lateOnly[0].dates).toContain('01/08/2026');

    const uaOnlyDue = buildEligibilityViolationRows(
      dueEntry({
        lateDays: 7,
        uninformedAbsentDays: 3,
        lateDates: ['2026-08-01'],
        uninformedAbsentDates: ['2026-08-10', '2026-08-11', '2026-08-12'],
        reasons: ['UA_DUE', 'LATE_NEAR'],
      }),
      '2026-08',
    );
    expect(uaOnlyDue).toHaveLength(1);
    expect(uaOnlyDue[0].nameUr).toBe('بلا اطلاع غیر حاضری');
    expect(uaOnlyDue[0].count).toBe(3);
    expect(uaOnlyDue[0].dates).not.toContain('01/08/2026');

    const bothDue = buildEligibilityViolationRows(
      dueEntry({
        uninformedAbsentDays: 3,
        uninformedAbsentDates: ['2026-08-10', '2026-08-11', '2026-08-12'],
        reasons: ['LATE_DUE', 'UA_DUE'],
      }),
      '2026-08',
    );
    expect(bothDue.map((r) => r.nameUr)).toEqual([
      'تاخیر از حاضری',
      'بلا اطلاع غیر حاضری',
    ]);
  });
});

describe('issueDueSuspensionEligibilityNotices', () => {
  it('issues one SENT letter per employee/period and does not duplicate', async () => {
    const generateSystemLetter = jest.fn().mockResolvedValue({
      letter: { id: 'letter-1', status: LetterStatus.SENT },
    });
    const findMany = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        employeeId: 'emp-due',
        variables: { eligibilityPeriod: '2026-08' },
        content: {},
      },
    ]);

    const prisma = { letter: { findMany } };
    const due = [dueEntry({})];

    const first = await issueDueSuspensionEligibilityNotices({
      prisma,
      lettersService: { generateSystemLetter },
      due,
      year: 2026,
      month: 8,
    });
    expect(first.issued).toBe(1);
    expect(generateSystemLetter).toHaveBeenCalledTimes(1);
    expect(generateSystemLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: 'emp-due',
        letterType: LetterType.SUSPENSION_ELIGIBILITY,
        extraFields: expect.objectContaining({
          eligibilityPeriod: '2026-08',
          violationRows: expect.arrayContaining([
            expect.objectContaining({ nameUr: 'تاخیر از حاضری', count: 9 }),
          ]),
        }),
      }),
      'SYSTEM',
    );

    const second = await issueDueSuspensionEligibilityNotices({
      prisma,
      lettersService: { generateSystemLetter },
      due,
      year: 2026,
      month: 8,
    });
    expect(second.issued).toBe(0);
    expect(second.skipped).toBe(1);
    expect(generateSystemLetter).toHaveBeenCalledTimes(1);
  });

  it('does not create inquiry, suspension request, or change employee status', async () => {
    const generateSystemLetter = jest.fn().mockResolvedValue({
      letter: { id: 'letter-1', status: LetterStatus.SENT },
    });
    const prisma = {
      letter: { findMany: jest.fn().mockResolvedValue([]) },
      employee: { update: jest.fn() },
      inquiry: { create: jest.fn() },
      suspensionRequest: { update: jest.fn() },
    };

    await issueDueSuspensionEligibilityNotices({
      prisma,
      lettersService: { generateSystemLetter },
      due: [dueEntry({})],
      year: 2026,
      month: 8,
    });

    expect(prisma.employee.update).not.toHaveBeenCalled();
    expect(prisma.inquiry.create).not.toHaveBeenCalled();
    expect(prisma.suspensionRequest.update).not.toHaveBeenCalled();
  });
});
