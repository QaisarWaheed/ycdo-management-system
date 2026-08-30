jest.mock('./../letters/auto-letter.helper', () => ({
  issueAutoTemplatedLetter: jest.fn().mockResolvedValue(undefined),
}));

import { AttendanceStatus, LetterType, UserRole } from '@prisma/client';
import { AttendanceService } from './attendance.service';

const EMP_ID = 'emp-status-update-1';
const ACTING_USER = { id: 'user-1', role: UserRole.HR_EXECUTIVE };
const BUSINESS_DATE = new Date(Date.UTC(2026, 7, 20)); // 20 Aug 2026
const DATE_LABEL = '2026-08-20';

/** PKT 07:45 — on-time for 08:00 duty */
const CHECK_IN_ON_TIME = '2026-08-20T07:45:00+05:00';
/** PKT 11:45 — late enough for HALF_DAY against 08:00 duty */
const CHECK_IN_VERY_LATE = '2026-08-20T11:45:00+05:00';

function makeLateStatusUpdateService() {
  const payrollService = {
    recomputePendingPayrollForAttendanceDate: jest
      .fn()
      .mockResolvedValue(undefined),
  };
  const accessScopeService = {
    assertEmployeeAccess: jest.fn().mockResolvedValue(undefined),
    userHasPermissionOrScopedCapability: jest.fn().mockResolvedValue(true),
  };

  const existingLog = {
    id: 'log-1',
    employeeId: EMP_ID,
    date: BUSINESS_DATE,
    status: AttendanceStatus.PRESENT,
    checkIn: new Date(CHECK_IN_ON_TIME),
    checkOut: null,
    lateMinutes: 0,
    overtimeMinutes: 0,
    note: 'Auto-marked unmarked for month calendar',
    dutyStartTimeSnapshot: '08:00',
    dutyEndTimeSnapshot: '16:00',
    employee: {
      id: EMP_ID,
      fullName: 'Dawood Ahmed',
      employeeCode: 'YCDO-2026-0001',
      currentBranchId: 'branch-1',
      dutyStartTime: '08:00',
      dutyEndTime: '16:00',
      dutyTotalHours: null,
      currentDesignation: 'Staff',
      currentDepartment: { name: 'Ops' },
      shift: { name: 'Morning', startTime: '08:00', endTime: '16:00' },
    },
    branch: { id: 'branch-1', name: 'Main' },
  };

  let capturedUpdateData: Record<string, unknown> | null = null;
  let payrollEntry = {
    id: 'pe-1',
    status: 'PENDING' as const,
    totalDeductions: 0,
    netStipend: 30000,
  };
  const deductions: Array<{
    id: string;
    payrollEntryId: string;
    reason: string;
    amount: number;
    description: string;
  }> = [];
  const disciplineEvents: Array<{
    employeeId: string;
    category: string;
    incidentDate: string;
    occurrence: number;
  }> = [];
  const letters: Array<{
    id: string;
    letterType: LetterType;
    generatedAt: Date;
    variables: Record<string, unknown>;
    requiresAcknowledgement: boolean;
  }> = [];

  const tx = {
    employee: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) => {
        if (where.id !== EMP_ID) return null;
        return {
          id: EMP_ID,
          dutyStartTime: '08:00',
          dutyEndTime: '16:00',
          shift: { startTime: '08:00', endTime: '16:00' },
        };
      }),
      update: jest.fn(),
    },
    user: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    leaveRecord: { findFirst: jest.fn().mockResolvedValue(null) },
    attendanceLog: {
      findMany: jest.fn(() => []),
      update: jest.fn(
        (args: { data: Record<string, unknown> }) => {
          capturedUpdateData = args.data;
          return {
            ...existingLog,
            ...args.data,
            status: args.data.status ?? existingLog.status,
            lateMinutes: args.data.lateMinutes ?? existingLog.lateMinutes,
            checkIn: args.data.checkIn ?? existingLog.checkIn,
          };
        },
      ),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    notification: { create: jest.fn().mockResolvedValue({}) },
    stipendRecord: {
      findFirst: jest.fn(() => ({
        id: 'stipend-1',
        basicStipend: 30000,
        effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
        effectiveTo: null,
      })),
    },
    payrollEntry: {
      findUnique: jest.fn(() => payrollEntry),
      update: jest.fn(
        (args: {
          data: {
            totalDeductions?: { increment?: number };
            netStipend?: { decrement?: number };
          };
        }) => {
          if (args.data.totalDeductions?.increment != null) {
            payrollEntry.totalDeductions += args.data.totalDeductions.increment;
          }
          if (args.data.netStipend?.decrement != null) {
            payrollEntry.netStipend -= args.data.netStipend.decrement;
          }
          return payrollEntry;
        },
      ),
    },
    payrollDeduction: {
      findFirst: jest.fn(
        (args: {
          where: {
            payrollEntryId: string;
            reason: string;
            description?: string;
          };
        }) =>
          deductions.find(
            (d) =>
              d.payrollEntryId === args.where.payrollEntryId &&
              d.reason === args.where.reason &&
              (!args.where.description ||
                d.description === args.where.description),
          ) ?? null,
      ),
      create: jest.fn(
        (args: {
          data: {
            payrollEntryId: string;
            reason: string;
            amount: number;
            description: string;
          };
        }) => {
          const row = {
            id: `ded-${deductions.length + 1}`,
            ...args.data,
          };
          deductions.push(row);
          return row;
        },
      ),
      delete: jest.fn(),
    },
    disciplineEvent: {
      create: jest.fn(
        (args: {
          data: {
            employeeId: string;
            category: string;
            incidentDate: Date;
            occurrence: number;
          };
        }) => {
          const incidentDate = args.data.incidentDate
            .toISOString()
            .slice(0, 10);
          const exists = disciplineEvents.find(
            (e) =>
              e.employeeId === args.data.employeeId &&
              e.category === args.data.category &&
              e.incidentDate === incidentDate,
          );
          if (exists) {
            const err = new Error('unique constraint') as Error & {
              code: string;
            };
            err.code = 'P2002';
            throw err;
          }
          disciplineEvents.push({
            employeeId: args.data.employeeId,
            category: args.data.category,
            incidentDate,
            occurrence: args.data.occurrence,
          });
          return {};
        },
      ),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    letter: {
      findMany: jest.fn(() => letters),
      create: jest.fn(
        (args: {
          data: {
            letterType: LetterType;
            variables: Record<string, unknown>;
          };
        }) => {
          const letter = {
            id: `letter-${letters.length + 1}`,
            letterType: args.data.letterType,
            generatedAt: new Date(),
            variables: args.data.variables,
            requiresAcknowledgement: true,
          };
          letters.push(letter);
          return letter;
        },
      ),
      update: jest.fn(),
    },
  };

  const prisma = {
    attendanceLog: {
      findUnique: jest.fn().mockResolvedValue(existingLog),
    },
    mutualSwap: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (cb: (client: typeof tx) => unknown) =>
      cb(tx),
    ),
  };

  const service = new AttendanceService(
    prisma as any,
    { userHasPermission: jest.fn() } as any,
    accessScopeService as any,
    payrollService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { upsertFromRelieverSession: jest.fn().mockResolvedValue(null) } as any,
  );

  return {
    service,
    getCapturedUpdate: () => capturedUpdateData,
    getDisciplineEvents: () => disciplineEvents,
    getDeductions: () => deductions,
    payrollService,
  };
}

describe('AttendanceService.updateAttendance — status-changing check-in edits', () => {
  it('persists HALF_DAY when a late check-in crosses the half-day threshold', async () => {
    const { service, getCapturedUpdate, getDisciplineEvents, getDeductions } =
      makeLateStatusUpdateService();

    await service.updateAttendance(
      'log-1',
      { checkIn: CHECK_IN_VERY_LATE } as any,
      ACTING_USER,
    );

    const update = getCapturedUpdate();
    expect(update?.status).toBe(AttendanceStatus.HALF_DAY);
    expect(update?.checkIn).toEqual(new Date(CHECK_IN_VERY_LATE));
    expect((update?.lateMinutes as number) ?? 0).toBeGreaterThan(60);

    // Post-write reconcile applies late discipline once and half-day pay deduction.
    expect(getDisciplineEvents()).toHaveLength(1);
    expect(getDisciplineEvents()[0].incidentDate).toBe(DATE_LABEL);
    expect(getDeductions()).toHaveLength(1);
    expect(getDeductions()[0].reason).toBe('HALF_DAY');
  });

  it('persists LATE when check-in is only slightly late', async () => {
    const { service, getCapturedUpdate, getDisciplineEvents } =
      makeLateStatusUpdateService();

    await service.updateAttendance(
      'log-1',
      { checkIn: '2026-08-20T08:20:00+05:00' } as any,
      ACTING_USER,
    );

    const update = getCapturedUpdate();
    expect(update?.status).toBe(AttendanceStatus.LATE);
    expect((update?.lateMinutes as number) ?? 0).toBeGreaterThan(0);
    expect((update?.lateMinutes as number) ?? 0).toBeLessThanOrEqual(60);
    expect(getDisciplineEvents()).toHaveLength(1);
  });

  it('does not invoke late discipline when the new check-in stays on time', async () => {
    const { service, getCapturedUpdate, getDisciplineEvents } =
      makeLateStatusUpdateService();

    await service.updateAttendance(
      'log-1',
      { checkIn: '2026-08-20T08:10:00+05:00' } as any,
      ACTING_USER,
    );

    const update = getCapturedUpdate();
    expect(update?.status).toBe(AttendanceStatus.PRESENT);
    expect(getDisciplineEvents()).toHaveLength(0);
  });
});
