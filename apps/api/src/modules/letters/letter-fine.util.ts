import { BadRequestException } from '@nestjs/common';
import { DeductionType, FineReason, LetterType, Prisma } from '@prisma/client';
import { pakistanYearMonthFromDate } from '../attendance/attendance-calendar.util';
import { lockPayrollEmployee } from '../payroll/payroll-write-lock.util';

export const LETTER_FINE_PREFIX = 'Letter fine [';
/** Letter fine presets that have a payslip fine category (ABSENT/LATE_DEDUCTION are attendance-owned; ELECTRICITY has none). */
const PRESET_FINE_REASON: Record<string, FineReason> = { UNIFORM: FineReason.NO_UNIFORM };
type FineLetter = { id: string; employeeId: string; letterType: LetterType; generatedAt: Date; letterNo?: string | null; variables: unknown; content?: unknown };
function manualFineVariables(letter: FineLetter) {
  const vars = { ...((letter.content ?? {}) as Record<string, unknown>), ...((letter.variables ?? {}) as Record<string, unknown>) };
  return (letter.letterType === LetterType.FINE || letter.letterType === LetterType.EXPLANATION_FINE) &&
    !vars.disciplineCategory && !vars.inquiryId && !vars.reversed && !vars.reversedDueToShortLeave &&
    !['ABSENT', 'LATE_DEDUCTION'].includes(String(vars.finePreset)) ? vars : null;
}
export function letterFine(letter: FineLetter) {
  const vars = manualFineVariables(letter);
  if (!vars) return null;
  const raw = String(vars.payrollFineAmount ?? vars.fineAmount ?? '').trim().replace(/,/g, '');
  const match = raw.match(/^(?:Rs\.?\s*|PKR\s*)?(\d+(?:\.\d{1,2})?)(?:\s*\/-|\s*rupees)?$/i);
  const amount = match ? Number(match[1]) : vars.finePreset === 'UNIFORM' && !raw ? 200 : 0;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 99999999.99) return null;
  let { year, month } = pakistanYearMonthFromDate(letter.generatedAt);
  const period = String(vars.payrollFineMonth ?? vars.deductionMonth ?? '').trim();
  const iso = period.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (iso) { year = Number(iso[1]); month = Number(iso[2]); }
  else if (period) {
    const months = ['January|جنوری','February|فروری','March|مارچ','April|اپریل','May|مئی','June|جون','July|جولائی','August|اگست','September|ستمبر','October|اکتوبر','November|نومبر','December|دسمبر'];
    const index = months.findIndex(name => new RegExp(name, 'i').test(period));
    const statedYear = period.match(/\b(20\d{2})\b/);
    if (index < 0) return null;
    month = index + 1; if (statedYear) year = Number(statedYear[1]);
  }
  return { letterId: letter.id, month, year, amount, reason: DeductionType.DISCIPLINARY_FINE,
    fineReason: PRESET_FINE_REASON[String(vars.finePreset)] ?? null,
    description: `${LETTER_FINE_PREFIX}${letter.id}] ${letter.letterNo ?? letter.id} — ${String(vars.fineReason || vars.violations || vars.finePreset || 'Fine')}` };
}

/** Sending before payroll exists is supported: payroll rebuild collects SENT letters. */
export async function applyLetterFine(tx: Prisma.TransactionClient, letter: FineLetter) {
  const fine = letterFine(letter);
  if (!fine && manualFineVariables(letter)) throw new BadRequestException('Enter a positive numeric payroll fine amount (PKR) before sending this fine letter.');
  if (!fine) return;
  await lockPayrollEmployee(tx, letter.employeeId);
  const existing = await tx.payrollDeduction.findFirst({ where: {
    description: { startsWith: `${LETTER_FINE_PREFIX}${letter.id}]` }, payrollEntry: { stipendRecord: { employeeId: letter.employeeId } },
  } });
  if (existing) return;
  const entries = await tx.payrollEntry.findMany({ where: {
    month: fine.month, year: fine.year, stipendRecord: { employeeId: letter.employeeId },
  }, orderBy: { createdAt: 'desc' } });
  // Req 18: the fine month is already verified / processed / paid → the fine
  // is taken from the next open month's salary (payroll rebuild does the same
  // when that month's slip does not exist yet).
  let entry = entries[0];
  let description = fine.description;
  if (entries.some(row => row.status !== 'PENDING')) {
    const after = fine.year * 12 + fine.month;
    entry = (await tx.payrollEntry.findMany({
      where: { status: 'PENDING', stipendRecord: { employeeId: letter.employeeId } },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    })).find(row => row.year * 12 + row.month > after);
    description = `${fine.description} (fine for ${fine.month}/${fine.year})`;
  }
  if (!entry) return;
  await tx.payrollDeduction.create({ data: { payrollEntryId: entry.id, reason: fine.reason, fineReason: fine.fineReason, amount: fine.amount, description } });
  await tx.payrollEntry.update({ where: { id: entry.id }, data: {
    totalDeductions: { increment: fine.amount }, netStipend: { decrement: fine.amount },
  } });
}
