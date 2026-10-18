import { ForbiddenException } from '@nestjs/common';
import { PayrollActivity, PayrollReviewKind, PayrollStatus, UserRole } from '@prisma/client';
import { ActivityWindowsService, activityWindow } from './activity-windows';
import { correctionLineAmounts } from '../payroll/salary-correction.service';
import { salaryReviewDeadline } from '../stipend-receipts/stipend-receipts.service';
import { PayrollWorkflowService } from '../payroll/payroll-workflow.service';

// PKT = UTC+5.
const pkt = (iso: string) => new Date(new Date(`${iso}Z`).getTime() - 5 * 3600_000);

describe('Req 20.7 activity windows', () => {
  it('employee review is open 1st 00:00 → 3rd 12:00 PKT for last month', () => {
    const w = activityWindow(PayrollActivity.EMPLOYEE_SALARY_REVIEW, pkt('2026-11-02T09:00:00'));
    expect(w).toMatchObject({ open: true, payrollMonth: 10, payrollYear: 2026 });
    expect(activityWindow(PayrollActivity.EMPLOYEE_SALARY_REVIEW, pkt('2026-11-03T12:00:00')).open).toBe(false);
    expect(activityWindow(PayrollActivity.EMPLOYEE_SALARY_REVIEW, pkt('2026-11-03T11:59:00')).open).toBe(true);
  });

  it('HR 3rd 12:00 → 5th 12:00, Finance 5th 12:00 → end of 7th, PC 7th → end of 10th', () => {
    expect(activityWindow(PayrollActivity.HR_SALARY_CORRECTIONS, pkt('2026-11-04T10:00:00')).open).toBe(true);
    expect(activityWindow(PayrollActivity.HR_SALARY_CORRECTIONS, pkt('2026-11-05T12:01:00')).open).toBe(false);
    expect(activityWindow(PayrollActivity.FINANCE_VERIFICATION, pkt('2026-11-07T23:30:00')).open).toBe(true);
    expect(activityWindow(PayrollActivity.FINANCE_VERIFICATION, pkt('2026-11-08T00:01:00')).open).toBe(false);
    expect(activityWindow(PayrollActivity.PC_PROOF_READING, pkt('2026-11-10T22:00:00')).open).toBe(true);
    expect(activityWindow(PayrollActivity.PC_PROOF_READING, pkt('2026-11-11T00:01:00')).open).toBe(false);
  });

  it('January salary review covers December of last year', () => {
    expect(activityWindow(PayrollActivity.EMPLOYEE_SALARY_REVIEW, pkt('2027-01-01T08:00:00'))).toMatchObject({
      payrollMonth: 12,
      payrollYear: 2026,
    });
  });

  it('executives are never limited; others need the window or an IT extension', async () => {
    const prisma = { activityExtension: { findFirst: jest.fn().mockResolvedValue(null) } };
    const s = new ActivityWindowsService(prisma as never);
    await expect(s.assertOpen(PayrollActivity.PC_PROOF_READING, { id: 'f', roles: [UserRole.FOUNDER] })).resolves.toBeUndefined();
    const st = await s.status(PayrollActivity.FINANCE_VERIFICATION, { id: 'p', roles: [UserRole.PAYROLL_OFFICER] }, pkt('2026-11-09T10:00:00'));
    expect(st.open).toBe(false);
    prisma.activityExtension.findFirst.mockResolvedValue({ endsAt: pkt('2026-11-09T18:00:00') });
    const ext = await s.status(PayrollActivity.FINANCE_VERIFICATION, { id: 'p', roles: [UserRole.PAYROLL_OFFICER] }, pkt('2026-11-09T10:00:00'));
    expect(ext.open).toBe(true);
  });
});

describe('Req 20.1 / 20.2 helpers', () => {
  it('salary review deadline is the 3rd of next month, 12:00 PKT', () => {
    expect(salaryReviewDeadline(10, 2026).toISOString()).toBe('2026-11-03T07:00:00.000Z');
    expect(salaryReviewDeadline(12, 2026).toISOString()).toBe('2027-01-03T07:00:00.000Z');
  });

  it('prices overtime hours, extra-duty days and amounts', () => {
    // basic 31,000 / 31 days = 1,000 a day; 8h duty = 125 an hour.
    const r = correctionLineAmounts(
      [
        { kind: 'OVERTIME', hours: 3 },
        { kind: 'EXTRA_DUTY', days: 1 },
        { kind: 'DEDUCT', amount: 200 },
      ],
      { basic: 31000, daysInMonth: 31, dailyHours: 8 },
    );
    expect(r.lines.map((l) => l.amount)).toEqual([375, 1000, 200]);
    expect(r.impact).toBe(1175);
  });
});

describe('Req 20 proof-reading', () => {
  it('PC cannot verify a salary with an open issue at the Founder', async () => {
    const prisma = {
      payrollReviewIssue: {
        findMany: jest.fn().mockResolvedValue([{ payrollEntryId: 'e1' }]),
        updateMany: jest.fn(),
      },
      payrollEntry: { findUnique: jest.fn().mockResolvedValue({ status: PayrollStatus.FOUNDER_APPROVED }) },
    };
    const payroll = { updateStatus: jest.fn() };
    const windows = { assertOpen: jest.fn() };
    const svc = new PayrollWorkflowService(prisma as never, payroll as never, windows as never);
    const r = await svc.pcVerify(['e1', 'e2'], { id: 'pc', roles: [UserRole.PROJECT_COORDINATOR] });
    expect(payroll.updateStatus).toHaveBeenCalledTimes(1);
    expect(payroll.updateStatus).toHaveBeenCalledWith('e2', { status: PayrollStatus.PC_VERIFIED }, 'pc');
    expect(r.failed).toEqual([{ entryId: 'e1', error: 'Open proof-reading issue with the Founder' }]);
    void PayrollReviewKind;
    void ForbiddenException;
  });
});
