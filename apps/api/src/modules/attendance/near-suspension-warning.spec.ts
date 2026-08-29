import { LetterStatus, LetterType } from '@prisma/client';
import {
  buildNearWarningViolationRows,
  issueNearSuspensionWarnings,
} from './near-suspension-warning';
import { issueDueSuspensionEligibilityNotices } from './suspension-eligibility-notice';
import type { SuspensionWatchlistEntry } from './suspension-watchlist';

function nearEntry(
  overrides: Partial<SuspensionWatchlistEntry>,
): SuspensionWatchlistEntry {
  return {
    employeeId: 'emp-near',
    fullName: 'Near Late',
    employeeCode: 'N1',
    biometricId: null,
    phone: null,
    branchId: null,
    branchName: null,
    lateDays: 7,
    uninformedAbsentDays: 0,
    lateDates: [
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
    ],
    uninformedAbsentDates: [],
    reasons: ['LATE_NEAR'],
    ...overrides,
  };
}

function dueEntry(): SuspensionWatchlistEntry {
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
    lateDates: Array.from({ length: 9 }, (_, i) => `2026-08-0${i + 1}`),
    uninformedAbsentDates: [],
    reasons: ['LATE_DUE'],
  };
}

describe('buildNearWarningViolationRows', () => {
  it('includes only Near-causing categories and omits empty ones', () => {
    const lateOnly = buildNearWarningViolationRows(nearEntry({}), '2026-08');
    expect(lateOnly).toHaveLength(1);
    expect(lateOnly[0].nameUr).toBe('تاخیر از حاضری');
    expect(lateOnly[0].count).toBe(7);

    const uaOnly = buildNearWarningViolationRows(
      nearEntry({
        lateDays: 0,
        lateDates: [],
        uninformedAbsentDays: 2,
        uninformedAbsentDates: ['2026-08-02', '2026-08-03'],
        reasons: ['UA_NEAR'],
      }),
      '2026-08',
    );
    expect(uaOnly).toHaveLength(1);
    expect(uaOnly[0].nameUr).toBe('بلا اطلاع غیر حاضری');
    expect(uaOnly[0].count).toBe(2);

    const dueRows = buildNearWarningViolationRows(dueEntry(), '2026-08');
    expect(dueRows).toHaveLength(0);
  });
});

describe('issueNearSuspensionWarnings', () => {
  it('issues one SENT warning per near employee/period and does not duplicate', async () => {
    const generateSystemLetter = jest.fn().mockResolvedValue({
      letter: { id: 'letter-n1', status: LetterStatus.SENT },
    });
    const findMany = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        employeeId: 'emp-near',
        variables: { warningPeriod: '2026-08' },
        content: {},
      },
    ]);

    const prisma = { letter: { findMany } };
    const near = [nearEntry({})];

    const first = await issueNearSuspensionWarnings({
      prisma,
      lettersService: { generateSystemLetter },
      near,
      year: 2026,
      month: 8,
    });
    expect(first.issued).toBe(1);
    expect(generateSystemLetter).toHaveBeenCalledTimes(1);
    expect(generateSystemLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: 'emp-near',
        letterType: LetterType.NEAR_SUSPENSION_WARNING,
        extraFields: expect.objectContaining({
          warningPeriod: '2026-08',
        }),
      }),
      'SYSTEM',
    );

    const second = await issueNearSuspensionWarnings({
      prisma,
      lettersService: { generateSystemLetter },
      near,
      year: 2026,
      month: 8,
    });
    expect(second.issued).toBe(0);
    expect(second.skipped).toBe(1);
    expect(generateSystemLetter).toHaveBeenCalledTimes(1);
  });

  it('does not issue a Near warning for Due employees', async () => {
    const generateSystemLetter = jest.fn();
    const result = await issueNearSuspensionWarnings({
      prisma: { letter: { findMany: jest.fn() } },
      lettersService: { generateSystemLetter },
      near: [],
      year: 2026,
      month: 8,
    });
    expect(result.issued).toBe(0);
    expect(generateSystemLetter).not.toHaveBeenCalled();
  });

  it('allows a new month warning and a separate Due eligibility letter', async () => {
    const generateSystemLetter = jest.fn().mockResolvedValue({
      letter: { id: 'letter', status: LetterStatus.SENT },
    });
    const prisma = {
      letter: { findMany: jest.fn().mockResolvedValue([]) },
      employee: { update: jest.fn() },
      inquiry: { create: jest.fn() },
      suspensionRequest: { update: jest.fn() },
    };

    await issueNearSuspensionWarnings({
      prisma,
      lettersService: { generateSystemLetter },
      near: [nearEntry({})],
      year: 2026,
      month: 8,
    });
    await issueNearSuspensionWarnings({
      prisma,
      lettersService: { generateSystemLetter },
      near: [nearEntry({})],
      year: 2026,
      month: 9,
    });
    await issueDueSuspensionEligibilityNotices({
      prisma,
      lettersService: { generateSystemLetter },
      due: [dueEntry()],
      year: 2026,
      month: 8,
    });

    const types = generateSystemLetter.mock.calls.map(
      (c: [{ letterType: LetterType }]) => c[0].letterType,
    );
    expect(types).toEqual([
      LetterType.NEAR_SUSPENSION_WARNING,
      LetterType.NEAR_SUSPENSION_WARNING,
      LetterType.SUSPENSION_ELIGIBILITY,
    ]);
    expect(prisma.employee.update).not.toHaveBeenCalled();
    expect(prisma.inquiry.create).not.toHaveBeenCalled();
    expect(prisma.suspensionRequest.update).not.toHaveBeenCalled();
  });
});
