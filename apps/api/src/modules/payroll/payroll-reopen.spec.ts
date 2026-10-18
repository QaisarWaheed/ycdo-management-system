import { PayrollStatus } from '@prisma/client';
import { PayrollService } from './payroll.service';

// Only Super Admin may move a Processed / Paid salary back to Pending.
describe('payroll reopen for correction', () => {
  const check =
    (current: PayrollStatus, next: PayrollStatus, canReopen: boolean) => () =>
      (
        Object.create(PayrollService.prototype) as {
          validateStatusTransition: (
            c: PayrollStatus,
            n: PayrollStatus,
            r: boolean,
          ) => void;
        }
      ).validateStatusTransition(current, next, canReopen);

  it('Super Admin can reopen Paid or Processed', () => {
    expect(
      check(PayrollStatus.PAID, PayrollStatus.PENDING, true),
    ).not.toThrow();
    expect(
      check(PayrollStatus.PROCESSED, PayrollStatus.PENDING, true),
    ).not.toThrow();
  });

  it('others cannot reopen', () => {
    expect(check(PayrollStatus.PAID, PayrollStatus.PENDING, false)).toThrow(
      /Super Admin/,
    );
  });

  it('Req 12: Pending → Verified (Finance) → Processed; no skipping verification', () => {
    expect(check(PayrollStatus.PENDING, PayrollStatus.VERIFIED, false)).not.toThrow();
    expect(check(PayrollStatus.VERIFIED, PayrollStatus.PROCESSED, false)).not.toThrow();
    expect(check(PayrollStatus.PENDING, PayrollStatus.PROCESSED, false)).toThrow(/Verify by Finance/);
    expect(check(PayrollStatus.PENDING, PayrollStatus.PAID, true)).toThrow();
  });
});
