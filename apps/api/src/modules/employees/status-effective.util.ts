import { EmployeeStatus, Prisma } from '@prisma/client';
import { toPakistanDateOnly } from '../attendance/attendance-late.util';

/** Statuses where attendance/pay stop from statusEffectiveFrom onward. */
export const EXIT_EMPLOYEE_STATUSES: EmployeeStatus[] = [
  EmployeeStatus.RESIGNED,
  EmployeeStatus.TERMINATED,
  EmployeeStatus.ON_REST,
  EmployeeStatus.DISMISSED,
];

/** Portal login blocked immediately when the record carries these statuses. */
export const PORTAL_BLOCKED_EMPLOYEE_STATUSES: EmployeeStatus[] = [
  ...EXIT_EMPLOYEE_STATUSES,
];

export function isExitEmployeeStatus(status: EmployeeStatus): boolean {
  return EXIT_EMPLOYEE_STATUSES.includes(status);
}

export function isPortalBlockedEmployeeStatus(status: EmployeeStatus): boolean {
  return PORTAL_BLOCKED_EMPLOYEE_STATUSES.includes(status);
}

export function resolveStatusEffectiveFromDate(
  effectiveFromInput: string | null | undefined,
  now: Date = new Date(),
): Date {
  if (effectiveFromInput?.trim()) {
    return toPakistanDateOnly(new Date(effectiveFromInput));
  }
  return toPakistanDateOnly(now);
}

/** Last paid / last working calendar day before an exit/rest/dismiss effective date. */
export function lastWorkingDayBeforeEffective(statusEffectiveFrom: Date): Date {
  const effective = toPakistanDateOnly(statusEffectiveFrom);
  return new Date(effective.getTime() - 24 * 60 * 60 * 1000);
}

export function effectiveFromAfterLastWorkingDay(lastWorkingDate: Date): Date {
  const last = toPakistanDateOnly(lastWorkingDate);
  return new Date(last.getTime() + 24 * 60 * 60 * 1000);
}

export function isPostExitAttendanceDate(
  date: Date,
  status: EmployeeStatus,
  statusEffectiveFrom: Date | null | undefined,
): boolean {
  if (!isExitEmployeeStatus(status)) return false;
  if (!statusEffectiveFrom) return true;
  return (
    toPakistanDateOnly(date).getTime() >=
    toPakistanDateOnly(statusEffectiveFrom).getTime()
  );
}

export function isPreActiveAttendanceDate(
  date: Date,
  status: EmployeeStatus,
  statusEffectiveFrom: Date | null | undefined,
): boolean {
  if (status !== EmployeeStatus.ACTIVE && status !== EmployeeStatus.TRAINEE) {
    return false;
  }
  if (!statusEffectiveFrom) return false;
  return (
    toPakistanDateOnly(date).getTime() <
    toPakistanDateOnly(statusEffectiveFrom).getTime()
  );
}

export function isOperationalAttendanceDate(
  date: Date,
  employee: {
    status: EmployeeStatus;
    statusEffectiveFrom?: Date | null;
    joiningDate?: Date | null;
  },
): boolean {
  if (employee.joiningDate) {
    const join = toPakistanDateOnly(employee.joiningDate);
    if (toPakistanDateOnly(date).getTime() < join.getTime()) {
      return false;
    }
  }
  if (
    isPostExitAttendanceDate(
      date,
      employee.status,
      employee.statusEffectiveFrom,
    )
  ) {
    return false;
  }
  if (
    isPreActiveAttendanceDate(
      date,
      employee.status,
      employee.statusEffectiveFrom,
    )
  ) {
    return false;
  }
  if (isExitEmployeeStatus(employee.status)) {
    return !!employee.statusEffectiveFrom;
  }
  if (
    employee.status === EmployeeStatus.ACTIVE ||
    employee.status === EmployeeStatus.TRAINEE ||
    employee.status === EmployeeStatus.APPOINTED
  ) {
    return true;
  }
  return false;
}

export function isSchedulerAttendanceEligible(
  employee: {
    status: EmployeeStatus;
    statusEffectiveFrom?: Date | null;
    joiningDate?: Date | null;
    relieverOnly?: boolean;
  },
  date: Date,
): boolean {
  if (employee.relieverOnly) return false;
  if (employee.status === EmployeeStatus.APPOINTED) {
    return isOperationalAttendanceDate(date, employee);
  }
  if (
    employee.status !== EmployeeStatus.ACTIVE &&
    employee.status !== EmployeeStatus.TRAINEE &&
    !isExitEmployeeStatus(employee.status)
  ) {
    return false;
  }
  return isOperationalAttendanceDate(date, employee);
}

export function buildStatusEffectiveFromUpdate(
  newStatus: EmployeeStatus,
  effectiveFromInput: string | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (isExitEmployeeStatus(newStatus)) {
    return resolveStatusEffectiveFromDate(effectiveFromInput, now);
  }
  if (newStatus === EmployeeStatus.ACTIVE) {
    if (effectiveFromInput?.trim()) {
      return resolveStatusEffectiveFromDate(effectiveFromInput, now);
    }
    return null;
  }
  return null;
}

export function schedulerAttendanceCandidateWhere(): Prisma.EmployeeWhereInput {
  return {
    OR: [
      {
        status: {
          in: [
            EmployeeStatus.ACTIVE,
            EmployeeStatus.TRAINEE,
            EmployeeStatus.APPOINTED,
          ],
        },
      },
      {
        status: { in: EXIT_EMPLOYEE_STATUSES },
        statusEffectiveFrom: { not: null },
      },
    ],
  };
}

export async function syncEmployeePortalAccess(
  tx: Prisma.TransactionClient,
  employeeId: string,
  status: EmployeeStatus,
): Promise<void> {
  if (isPortalBlockedEmployeeStatus(status)) {
    await tx.user.updateMany({
      where: { employeeId },
      data: { isActive: false },
    });
    return;
  }
  if (status === EmployeeStatus.ACTIVE) {
    await tx.user.updateMany({
      where: { employeeId },
      data: { isActive: true },
    });
  }
}
