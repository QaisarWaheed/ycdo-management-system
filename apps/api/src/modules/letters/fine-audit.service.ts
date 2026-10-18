import { Controller, Get, Injectable, Post, UseGuards } from '@nestjs/common';
import { LetterStatus, LetterType, PayrollStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles, StrictRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { lockPayrollEmployee } from '../payroll/payroll-write-lock.util';
import { applyLetterFine, letterFine, LETTER_FINE_PREFIX } from './letter-fine.util';

const idFromDescription = (d: string | null) =>
  d?.startsWith(LETTER_FINE_PREFIX) ? d.slice(LETTER_FINE_PREFIX.length, d.indexOf(']')) : null;

type Issue = {
  kind: 'MISSING_DEDUCTION' | 'REVERSED_STILL_DEDUCTED' | 'AMOUNT_MISMATCH';
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  letterId: string | null;
  letterNo: string | null;
  month: number;
  year: number;
  letterAmount: number | null;
  deductedAmount: number | null;
  slipStatus: PayrollStatus | null;
  deductionId: string | null;
};

/**
 * Phase 3 Req 18: every sent manual fine letter (incl. uniform fines) must
 * have exactly its amount deducted once; a reversed / deleted letter must
 * have no deduction left. The audit lists every mismatch; Fix applies the
 * missing fines (next open month when the month is locked), removes fines of
 * reversed letters (Paid slips are left as paid) and corrects amounts.
 */
@Injectable()
export class FineAuditService {
  constructor(private prisma: PrismaService) {}

  async audit(): Promise<{ checkedLetters: number; checkedDeductions: number; issues: Issue[] }> {
    const [letters, deductions] = await Promise.all([
      this.prisma.letter.findMany({
        where: { letterType: { in: [LetterType.FINE, LetterType.EXPLANATION_FINE] } },
        include: { employee: { select: { fullName: true, employeeCode: true } } },
      }),
      this.prisma.payrollDeduction.findMany({
        where: { description: { startsWith: LETTER_FINE_PREFIX } },
        include: {
          payrollEntry: {
            select: {
              month: true,
              year: true,
              status: true,
              stipendRecord: {
                select: { employeeId: true, employee: { select: { fullName: true, employeeCode: true } } },
              },
            },
          },
        },
      }),
    ]);
    const byLetter = new Map<string, typeof deductions>();
    for (const d of deductions) {
      const id = idFromDescription(d.description);
      if (!id) continue;
      byLetter.set(id, [...(byLetter.get(id) ?? []), d]);
    }
    const issues: Issue[] = [];
    const letterIds = new Set(letters.map((l) => l.id));
    for (const l of letters) {
      const fine = l.status === LetterStatus.SENT ? letterFine(l) : null;
      const rows = byLetter.get(l.id) ?? [];
      const deducted = rows.reduce((s, r) => s + Number(r.amount), 0);
      const base = {
        employeeId: l.employeeId,
        employeeName: l.employee.fullName,
        employeeCode: l.employee.employeeCode,
        letterId: l.id,
        letterNo: l.letterNo,
      };
      if (fine) {
        const hasSlip = await this.prisma.payrollEntry.count({
          where: { month: fine.month, year: fine.year, stipendRecord: { employeeId: l.employeeId } },
        });
        if (!rows.length && hasSlip) {
          issues.push({ ...base, kind: 'MISSING_DEDUCTION', month: fine.month, year: fine.year, letterAmount: fine.amount, deductedAmount: 0, slipStatus: null, deductionId: null });
        } else if (rows.length && Math.abs(deducted - fine.amount) > 0.004) {
          issues.push({ ...base, kind: 'AMOUNT_MISMATCH', month: fine.month, year: fine.year, letterAmount: fine.amount, deductedAmount: deducted, slipStatus: rows[0].payrollEntry.status, deductionId: rows[0].id });
        }
      } else if (rows.length && l.status !== LetterStatus.SENT) {
        for (const r of rows) {
          issues.push({ ...base, kind: 'REVERSED_STILL_DEDUCTED', month: r.payrollEntry.month, year: r.payrollEntry.year, letterAmount: null, deductedAmount: Number(r.amount), slipStatus: r.payrollEntry.status, deductionId: r.id });
        }
      }
    }
    // Fines whose letter no longer exists.
    for (const d of deductions) {
      const id = idFromDescription(d.description);
      if (!id || letterIds.has(id)) continue;
      const emp = d.payrollEntry.stipendRecord;
      issues.push({
        kind: 'REVERSED_STILL_DEDUCTED',
        employeeId: emp.employeeId,
        employeeName: emp.employee.fullName,
        employeeCode: emp.employee.employeeCode,
        letterId: id,
        letterNo: null,
        month: d.payrollEntry.month,
        year: d.payrollEntry.year,
        letterAmount: null,
        deductedAmount: Number(d.amount),
        slipStatus: d.payrollEntry.status,
        deductionId: d.id,
      });
    }
    return { checkedLetters: letters.length, checkedDeductions: deductions.length, issues };
  }

  async fix(actorId: string) {
    const { issues } = await this.audit();
    let fixed = 0;
    const skipped: string[] = [];
    for (const i of issues) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await lockPayrollEmployee(tx, i.employeeId);
          if (i.kind === 'MISSING_DEDUCTION' && i.letterId) {
            const letter = await tx.letter.findUniqueOrThrow({ where: { id: i.letterId } });
            await applyLetterFine(tx, letter);
          } else if (i.deductionId && i.slipStatus === PayrollStatus.PAID) {
            throw new Error('slip already paid — refund / recover on the next month by hand');
          } else if (i.kind === 'REVERSED_STILL_DEDUCTED' && i.deductionId) {
            const row = await tx.payrollDeduction.delete({ where: { id: i.deductionId } });
            await tx.payrollEntry.update({
              where: { id: row.payrollEntryId },
              data: { totalDeductions: { decrement: row.amount }, netStipend: { increment: row.amount } },
            });
          } else if (i.kind === 'AMOUNT_MISMATCH' && i.deductionId && i.letterAmount != null) {
            const diff = i.letterAmount - (i.deductedAmount ?? 0);
            const row = await tx.payrollDeduction.findUniqueOrThrow({ where: { id: i.deductionId } });
            await tx.payrollDeduction.update({ where: { id: row.id }, data: { amount: Number(row.amount) + diff } });
            await tx.payrollEntry.update({
              where: { id: row.payrollEntryId },
              data: { totalDeductions: { increment: diff }, netStipend: { decrement: diff } },
            });
          }
          await tx.auditLog.create({
            data: {
              userId: actorId,
              action: `FINE_AUDIT_FIX_${i.kind}`,
              entity: 'PayrollDeduction',
              entityId: i.deductionId ?? i.letterId ?? 'n/a',
              changes: { ...i },
            },
          });
        });
        fixed++;
      } catch (err) {
        skipped.push(`${i.employeeName} ${i.letterNo ?? i.letterId ?? ''}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { fixed, skipped };
  }
}

const FINE_AUDIT_ROLES = [UserRole.SUPER_ADMIN, UserRole.IT_ADMIN, UserRole.PAYROLL_OFFICER];

@Controller('fine-audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...FINE_AUDIT_ROLES)
@StrictRoles()
export class FineAuditController {
  constructor(private service: FineAuditService) {}

  @Get()
  audit() {
    return this.service.audit();
  }

  @Post('fix')
  fix(@CurrentUser() user: { id: string }) {
    return this.service.fix(user.id);
  }
}
