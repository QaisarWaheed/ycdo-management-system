import { calculateCardSalary, isLegacyAttendanceDeduction } from './attendance-card-salary.util';
const card = (changes = {}) => ({ calendarDays: 31, present: 31, absent: 0, uninformedAbsent: 0, late: 0, halfDay: 0, shortLeave: 0, onLeave: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, holiday: 0, swapCovered: 0, unmarked: 0, additionalWorkingDays: 0, overtimeHours: 0, ...changes });
describe('August Card salary', () => {
  it.each([
    ['Present', {}, 31000],
    ['Absent exactly 2 DR impact', { present: 30, absent: 1 }, 29000],
    ['UA exactly 2 DR impact', { present: 30, uninformedAbsent: 1 }, 29000],
    ['3 Late', { present: 28, late: 3 }, 30000],
    ['6 Late', { present: 25, late: 6 }, 29000],
    ['Half Day', { present: 30, halfDay: 1 }, 30500],
    ['Short Leave', { present: 30, shortLeave: 1 }, 31000],
    ['paid leave', { present: 29, onLeave: 2, paidLeaveDays: 2 }, 31000],
    ['excess leave', { present: 28, onLeave: 3, paidLeaveDays: 2, unpaidLeaveDays: 1 }, 30000],
    ['Holiday', { present: 30, holiday: 1 }, 31000],
    ['Unmarked zero wage/penalty', { present: 30, unmarked: 1 }, 30000],
    ['Swap', { present: 30, swapCovered: 1 }, 31000],
    ['AWD', { additionalWorkingDays: 1 }, 32000],
    ['OT', { overtimeHours: 8 }, 32000],
    ['combination', { present: 22, absent: 1, uninformedAbsent: 1, late: 3, halfDay: 1, shortLeave: 1, holiday: 1, unmarked: 1, additionalWorkingDays: 1 }, 25500],
  ])('%s', (_label, changes, expected) => expect(calculateCardSalary(card(changes), 31000, 8).attendanceSalary).toBe(expected));
  it('rejects double classifications', () => expect(() => calculateCardSalary(card({ holiday: 1 }), 31000, 8)).toThrow());
  it('preserves manual fine but identifies duplicate attendance rows', () => {
    expect(isLegacyAttendanceDeduction({ reason: 'LATE_ARRIVAL' })).toBe(true);
    expect(isLegacyAttendanceDeduction({ reason: 'DISCIPLINARY_FINE', description: 'Missing checkout deduction — monthly occurrence 3' })).toBe(true);
    expect(isLegacyAttendanceDeduction({ reason: 'DISCIPLINARY_FINE', description: 'Inquiry fine — case-1' })).toBe(false);
  });
});
