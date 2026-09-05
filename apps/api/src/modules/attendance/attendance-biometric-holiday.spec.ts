jest.mock('../letters/pdf.helper', () => ({}));
jest.mock('../letters/auto-letter.helper', () => ({
  issueAutoTemplatedLetter: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../letters/letters.service', () => ({ LettersService: class {} }));
jest.mock('../disciplinary/disciplinary.service', () => ({
  DisciplinaryService: class {},
}));

import { ConflictException, Logger } from '@nestjs/common';
import {
  AttendanceSource,
  AttendanceStatus,
  AttendanceLogType,
  EmployeeStatus,
} from '@prisma/client';
import { AttendanceService } from './attendance.service';
import {
  summarizeAttendanceLogs,
  toPayrollAttendanceReport,
} from './attendance-summary.util';
import * as discipline from './discipline.helper';
import { getDutyWindow, workedMinutes } from '../../common/duty.util';

const day = new Date('2026-08-14T00:00:00Z');
const at = (time: string) => new Date(`2026-08-14T${time}:00+05:00`);

function makeHarness(overrides: Record<string, unknown> = {}) {
  const employee = {
    id: 'holiday-employee',
    biometricId: '100',
    status: EmployeeStatus.ACTIVE,
    currentBranchId: 'branch-1',
    joiningDate: new Date('2020-01-01'),
    dutyStartTime: '09:00',
    dutyEndTime: '17:00',
    dutyTotalHours: 8,
    shift: null,
  };
  let log: any = {
    id: 'holiday-log',
    employeeId: employee.id,
    date: day,
    status: AttendanceStatus.HOLIDAY,
    type: AttendanceLogType.REGULAR,
    source: AttendanceSource.MANUAL,
    checkIn: null,
    checkOut: null,
    sessionClosedAt: null,
    lateMinutes: 0,
    overtimeMinutes: 0,
    overtimePending: false,
    overtimeApprovedAt: null,
    note: 'Company holiday',
    dutyStartTimeSnapshot: '09:00',
    dutyEndTimeSnapshot: '17:00',
    ...overrides,
  };
  const events = new Map<string, unknown>();
  const priorLateRows = Array.from({ length: 8 }, () => ({
    status: AttendanceStatus.LATE,
    lateMinutes: 30,
    overtimeMinutes: 0,
  }));
  const prisma: any = {
    employee: {
      findUnique: jest.fn().mockResolvedValue(employee),
      update: jest.fn(),
    },
    biometricDevice: { findUnique: jest.fn().mockResolvedValue(null) },
    mutualSwap: { findFirst: jest.fn().mockResolvedValue(null) },
    attendanceLog: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (
          where.employeeId !== log.employeeId ||
          where.date.getTime() !== log.date.getTime()
        )
          return null;
        if (where.checkIn?.not === null && log.checkIn === null) return null;
        if (where.checkOut === null && log.checkOut !== null) return null;
        if (where.sessionClosedAt === null && log.sessionClosedAt !== null)
          return null;
        return { ...log };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        expect(where.id).toBe(log.id);
        log = { ...log, ...data };
        return { ...log };
      }),
      create: jest.fn(),
    },
    processedDeviceEvent: {
      findUnique: jest.fn(
        async ({ where }: any) =>
          events.get(where.deviceId_serialNo.serialNo) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        events.set(data.serialNo, data);
        return data;
      }),
    },
    disciplineEvent: {
      count: jest.fn().mockResolvedValue(8),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    payrollDeduction: { create: jest.fn() },
    payrollEntry: { update: jest.fn() },
    letter: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const payroll = {
    recomputePendingPayrollForAttendanceDate: jest
      .fn()
      .mockResolvedValue(undefined),
  };
  const service = new AttendanceService(
    prisma,
    {} as any,
    {} as any,
    payroll as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const assertNoLateConsequences = () => {
    const summary = summarizeAttendanceLogs([...priorLateRows, log]);
    expect(summary).toMatchObject({
      holiday: 1,
      late: 8,
      halfDay: 0,
      totalLateMinutes: 240,
    });
    expect(toPayrollAttendanceReport(summary).late).toBe(8);
    expect(discipline.isLateEligibleForDiscipline(log)).toBe(false);
    expect(
      [...priorLateRows, log].filter(discipline.isLateEligibleForDiscipline),
    ).toHaveLength(8);
    expect(prisma.disciplineEvent.count).not.toHaveBeenCalled();
    expect(prisma.disciplineEvent.create).not.toHaveBeenCalled();
    expect(prisma.disciplineEvent.deleteMany).not.toHaveBeenCalled();
    expect(prisma.payrollDeduction.create).not.toHaveBeenCalled();
    expect(prisma.payrollEntry.update).not.toHaveBeenCalled();
    expect(prisma.employee.update).not.toHaveBeenCalled();
    expect(prisma.letter.create).not.toHaveBeenCalled();
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  };
  return {
    service,
    prisma,
    payroll,
    employee,
    getLog: () => ({ ...log }),
    assertNoLateConsequences,
  };
}

describe('biometric evidence on an existing HOLIDAY', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    // Run the real consequence reconciler: mocking it would hide Late/suspension regressions.
    jest.spyOn(discipline, 'reconcileAttendanceFinancialConsequences');
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe.each(['push', 'raw'] as const)('%s endpoint', (endpoint) => {
    it.each([
      ['normal', '09:00', 480],
      ['within the ordinary Late band', '09:45', 435],
      ['more than 120 minutes after duty start', '12:00', 300],
    ] as const)(
      '%s check-in/check-out retains HOLIDAY without card, payroll or discipline Late',
      async (_name, time, minutes) => {
        const h = makeHarness();
        const punch = (kind: 'CHECKIN' | 'CHECKOUT', serialNo: string) =>
          endpoint === 'push'
            ? h.service.biometricPush({ biometricId: '100', punchType: kind })
            : h.service.rawScan({
                biometricId: '100',
                deviceId: 'device-1',
                serialNo,
                deviceStatus: kind,
              });
        jest.setSystemTime(at(time));
        await punch('CHECKIN', '1');
        expect(h.getLog()).toMatchObject({
          status: AttendanceStatus.HOLIDAY,
          checkIn: at(time),
          checkOut: null,
          lateMinutes: 0,
          source: AttendanceSource.BIOMETRIC,
        });
        h.assertNoLateConsequences();

        // Same raw event is accepted only once; legacy explicit duplicates retain their conflict contract.
        if (endpoint === 'raw') {
          await expect(punch('CHECKIN', '1')).resolves.toMatchObject({
            idempotent: true,
            accepted: false,
          });
        } else {
          await expect(punch('CHECKIN', '1')).rejects.toBeInstanceOf(
            ConflictException,
          );
        }
        expect(h.prisma.attendanceLog.update).toHaveBeenCalledTimes(1);
        expect(
          h.payroll.recomputePendingPayrollForAttendanceDate,
        ).toHaveBeenCalledTimes(1);

        jest.setSystemTime(at('17:00'));
        await punch('CHECKOUT', '2');
        const completed = h.getLog();
        expect(completed).toMatchObject({
          status: AttendanceStatus.HOLIDAY,
          checkIn: at(time),
          checkOut: at('17:00'),
          lateMinutes: 0,
        });
        expect(
          workedMinutes(
            completed.checkIn,
            completed.checkOut,
            getDutyWindow(h.employee),
          ),
        ).toEqual({ minutes, anomalous: false });
        expect(h.prisma.attendanceLog.create).not.toHaveBeenCalled();
        expect(
          discipline.reconcileAttendanceFinancialConsequences,
        ).toHaveBeenCalledTimes(2);
        h.assertNoLateConsequences();

        if (endpoint === 'raw') {
          await expect(punch('CHECKOUT', '2')).resolves.toMatchObject({
            idempotent: true,
            accepted: false,
          });
          expect(h.getLog()).toEqual(completed);
          expect(h.prisma.attendanceLog.update).toHaveBeenCalledTimes(2);
          expect(
            h.payroll.recomputePendingPayrollForAttendanceDate,
          ).toHaveBeenCalledTimes(2);
          expect(
            discipline.reconcileAttendanceFinancialConsequences,
          ).toHaveBeenCalledTimes(2);
        }
      },
    );
  });

  it('checkout preserves an existing HOLIDAY even if legacy lateMinutes is greater than 120', async () => {
    const h = makeHarness({ checkIn: at('12:00'), lateMinutes: 165 });
    jest.setSystemTime(at('17:00'));
    await h.service.biometricPush({
      biometricId: '100',
      punchType: 'CHECKOUT',
    });
    expect(h.getLog()).toMatchObject({
      status: AttendanceStatus.HOLIDAY,
      checkIn: at('12:00'),
      checkOut: at('17:00'),
      lateMinutes: 0,
    });
    h.assertNoLateConsequences();
  });
});
