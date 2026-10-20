import {
  installmentForMonth,
  loanEligibility,
  serviceMonths,
} from './loans.util';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('loan rules', () => {
  it('needs 6 full months of service', () => {
    expect(serviceMonths(d('2026-04-21'), d('2026-10-20'))).toBe(5);
    expect(loanEligibility(d('2026-04-21'), d('2026-10-20')).eligible).toBe(
      false,
    );
    expect(loanEligibility(d('2026-04-20'), d('2026-10-20')).eligible).toBe(
      true,
    );
    expect(loanEligibility(null, d('2026-10-20')).eligible).toBe(false);
  });

  it('takes the monthly installment from the start month and only the rest at the end', () => {
    const loan = {
      amount: 100000,
      monthlyInstallment: 30000,
      startMonth: d('2026-11-01'),
    };
    expect(installmentForMonth(loan, 2026, 10, 0)).toBe(0);
    expect(installmentForMonth(loan, 2026, 11, 0)).toBe(30000);
    expect(installmentForMonth(loan, 2027, 2, 90000)).toBe(10000);
    expect(installmentForMonth(loan, 2027, 3, 100000)).toBe(0);
  });
});
