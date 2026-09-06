/** Financial arithmetic only. All daily classification/quota/extras come from the Card. */
export type SalaryAttendanceCard = {
  calendarDays: number; present: number; absent: number; uninformedAbsent: number;
  late: number; halfDay: number; shortLeave: number; onLeave: number;
  paidLeaveDays: number; unpaidLeaveDays: number; holiday: number; swapCovered: number;
  unmarked: number; additionalWorkingDays: number; overtimeHours: number;
};
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function calculateCardSalary(card: SalaryAttendanceCard, basic: number, workingHours: number) {
  const counts: Array<keyof SalaryAttendanceCard> = ['calendarDays','present','absent','uninformedAbsent','late','halfDay','shortLeave','onLeave','paidLeaveDays','unpaidLeaveDays','holiday','swapCovered','unmarked','additionalWorkingDays','overtimeHours'];
  for (const key of counts) if (!Number.isFinite(card[key]) || card[key] < 0) throw new Error('Invalid Attendance Card value');
  if (!Number.isFinite(basic) || basic < 0 || !Number.isFinite(workingHours) || workingHours <= 0 || card.calendarDays < 1) throw new Error('Valid Basic Stipend and Working Hours required');
  const classifications = card.present + card.absent + card.uninformedAbsent + card.late + card.halfDay + card.shortLeave + card.onLeave + card.holiday + card.swapCovered + card.unmarked;
  if (classifications > card.calendarDays || card.paidLeaveDays + card.unpaidLeaveDays !== card.onLeave) throw new Error('Attendance Card classifications/quota are inconsistent');
  const dailyRate = basic / card.calendarDays;
  const hourlyRate = dailyRate / workingHours;
  const paidDays = card.present + card.late + card.shortLeave + card.holiday + card.swapCovered + card.paidLeaveDays + card.halfDay * 0.5;
  const earnedBasic = round(paidDays * dailyRate);
  const absencePenalty = round((card.absent + card.uninformedAbsent) * dailyRate);
  const latePenalty = round(Math.floor(card.late / 3) * dailyRate);
  const additionalWorkingDayPay = round(card.additionalWorkingDays * dailyRate);
  const overtimePay = round(card.overtimeHours * hourlyRate);
  return { dailyRate, hourlyRate, paidDays, earnedBasic, absencePenalty, latePenalty, additionalWorkingDayPay, overtimePay,
    attendanceSalary: round(earnedBasic - absencePenalty - latePenalty + additionalWorkingDayPay + overtimePay) };
}

/** These categories now belong exclusively to the Card; legitimate unrelated fines remain. */
export function isLegacyAttendanceDeduction(row: { reason?: string; description?: string | null }) {
  if (['LATE_ARRIVAL', 'UNINFORMED_ABSENCE', 'UNPAID_LEAVE', 'HALF_DAY', 'EXTRA_LEAVE_REJECTED'].includes(row.reason ?? '')) return true;
  if (row.reason === 'DISCIPLINARY_FINE' && /^(Missing checkout deduction|Late arrival deduction)/.test(row.description ?? '')) return true;
  return row.reason === 'OTHER' && /^Unmarked day \(/.test(row.description ?? '');
}
export const CARD_ABSENCE_DESCRIPTION = 'Attendance Card: additional absence penalty';
export const CARD_LATE_DESCRIPTION = 'Attendance Card: every 3 Late';
