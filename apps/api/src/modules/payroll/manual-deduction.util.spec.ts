import { isManualDeduction } from './manual-deduction.util';

describe('isManualDeduction', () => {
  it('accepts the causes HR enters from the payroll modal', () => {
    for (const reason of [
      'MEDICINE_PENDING',
      'KITCHEN_PENDING',
      'LOAN',
      'ADVANCE',
      'ELECTRICITY_BILL',
      'MOBILE_BILL',
      'OTHER',
      'FINE',
    ]) {
      expect(isManualDeduction({ reason })).toBe(true);
    }
  });

  it('rejects attendance and disciplinary deductions', () => {
    expect(isManualDeduction({ reason: 'LATE_ARRIVAL' })).toBe(false);
    expect(isManualDeduction({ reason: 'UNINFORMED_ABSENCE' })).toBe(false);
    expect(isManualDeduction({ reason: 'DISCIPLINARY_FINE' })).toBe(false);
    expect(
      isManualDeduction({ reason: 'OTHER', description: 'Unmarked day (2026-09-01)' }),
    ).toBe(false);
  });
});
