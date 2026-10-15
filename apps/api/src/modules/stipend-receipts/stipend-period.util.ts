import { pakistanYearMonthFromDate } from '../attendance/attendance-calendar.util';
export function previousStipendPeriod(now = new Date()) {
  const current = pakistanYearMonthFromDate(now);
  return current.month === 1 ? { month: 12, year: current.year - 1 } : { month: current.month - 1, year: current.year };
}
export function completedStipendPeriods(now = new Date()) {
  const {month,year} = pakistanYearMonthFromDate(now);
  return { OR: [{year: {lt: year}}, {year, month: {lt: month}}] };
}
export function isCompletedStipendPeriod(month: number, year: number, now = new Date()) {
  const current = pakistanYearMonthFromDate(now);
  return year * 12 + month < current.year * 12 + current.month;
}
