import { EmployeeStatus } from '@prisma/client';
import {
  buildStatusEffectiveFromUpdate,
  effectiveFromAfterLastWorkingDay,
  isOperationalAttendanceDate,
  isPostExitAttendanceDate,
  isPreActiveAttendanceDate,
  lastWorkingDayBeforeEffective,
  resolveStatusEffectiveFromDate,
} from './status-effective.util';

describe('status-effective.util', () => {
  it('treats day before effective from as last working day on exit', () => {
    const effective = new Date(Date.UTC(2026, 2, 28));
    expect(lastWorkingDayBeforeEffective(effective).toISOString()).toBe(
      new Date(Date.UTC(2026, 2, 27)).toISOString(),
    );
    expect(effectiveFromAfterLastWorkingDay(new Date(Date.UTC(2026, 2, 27))).toISOString()).toBe(
      effective.toISOString(),
    );
  });

  it('blocks attendance from exit effective from onward', () => {
    const effective = new Date(Date.UTC(2026, 2, 28));
    expect(
      isPostExitAttendanceDate(
        new Date(Date.UTC(2026, 2, 27)),
        EmployeeStatus.RESIGNED,
        effective,
      ),
    ).toBe(false);
    expect(
      isPostExitAttendanceDate(
        new Date(Date.UTC(2026, 2, 28)),
        EmployeeStatus.RESIGNED,
        effective,
      ),
    ).toBe(true);
  });

  it('blocks attendance before Active reinstatement effective from', () => {
    const effective = new Date(Date.UTC(2026, 2, 1));
    expect(
      isPreActiveAttendanceDate(
        new Date(Date.UTC(2026, 1, 28)),
        EmployeeStatus.ACTIVE,
        effective,
      ),
    ).toBe(true);
    expect(
      isPreActiveAttendanceDate(
        new Date(Date.UTC(2026, 2, 1)),
        EmployeeStatus.ACTIVE,
        effective,
      ),
    ).toBe(false);
  });

  it('allows notice-period attendance for exit statuses before effective from', () => {
    const employee = {
      status: EmployeeStatus.RESIGNED,
      statusEffectiveFrom: new Date(Date.UTC(2026, 2, 28)),
      joiningDate: new Date(Date.UTC(2020, 0, 1)),
    };
    expect(
      isOperationalAttendanceDate(new Date(Date.UTC(2026, 2, 27)), employee),
    ).toBe(true);
    expect(
      isOperationalAttendanceDate(new Date(Date.UTC(2026, 2, 28)), employee),
    ).toBe(false);
  });

  it('defaults blank effective from to today', () => {
    const now = new Date(Date.UTC(2026, 2, 5, 12, 0, 0));
    expect(resolveStatusEffectiveFromDate(undefined, now).toISOString()).toBe(
      new Date(Date.UTC(2026, 2, 5)).toISOString(),
    );
  });

  it('builds statusEffectiveFrom for exit and clears for other statuses', () => {
    const now = new Date(Date.UTC(2026, 2, 5));
    expect(
      buildStatusEffectiveFromUpdate(EmployeeStatus.ON_REST, undefined, now)?.toISOString(),
    ).toBe(new Date(Date.UTC(2026, 2, 5)).toISOString());
    expect(
      buildStatusEffectiveFromUpdate(EmployeeStatus.TRAINEE, undefined, now),
    ).toBeNull();
  });
});
