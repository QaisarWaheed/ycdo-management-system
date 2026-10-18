import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { LetterStatus, LetterType, PayrollStatus, Prisma, UserRole } from '@prisma/client';
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
 * have no deduction left. The audit lists every mismatch; HR decides each
 * missing fine one by one (deduct on the next open month, or waive).
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

  /** HR decision on one letter: deduct now (next open month when its month is closed). */
  async deductOne(letterId: string, actorId: string) {
    const letter = await this.prisma.letter.findUnique({ where: { id: letterId } });
    if (!letter) throw new NotFoundException('Letter not found');
    if (!letterFine(letter)) throw new BadRequestException('This letter has no deductible fine');
    await this.prisma.$transaction(async (tx) => {
      await applyLetterFine(tx, letter);
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'FINE_AUDIT_DEDUCTED',
          entity: 'Letter',
          entityId: letterId,
          changes: { employeeId: letter.employeeId, letterNo: letter.letterNo },
        },
      });
    });
    const row = await this.prisma.payrollDeduction.findFirst({
      where: { description: { startsWith: `${LETTER_FINE_PREFIX}${letterId}]` } },
      include: { payrollEntry: { select: { month: true, year: true } } },
    });
    // No open month yet: the next payroll generation picks it up.
    return {
      letterId,
      deducted: !!row,
      month: row ? `${row.payrollEntry.month}/${row.payrollEntry.year}` : null,
    };
  }

  /** HR decision on one letter: waive the fine (kept in the letter and audit, never deducted). */
  async waiveOne(letterId: string, reason: string, actorId: string) {
    const letter = await this.prisma.letter.findUnique({ where: { id: letterId } });
    if (!letter) throw new NotFoundException('Letter not found');
    const vars = (letter.variables ?? {}) as Record<string, unknown>;
    await this.prisma.$transaction([
      this.prisma.letter.update({
        where: { id: letterId },
        data: {
          variables: {
            ...vars,
            fineWaived: true,
            fineWaivedReason: reason.trim(),
            fineWaivedById: actorId,
            fineWaivedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: actorId,
          action: 'FINE_AUDIT_WAIVED',
          entity: 'Letter',
          entityId: letterId,
          changes: { employeeId: letter.employeeId, letterNo: letter.letterNo, reason: reason.trim() },
        },
      }),
    ]);
    return { letterId, waived: true };
  }
}

const FINE_AUDIT_ROLES = [UserRole.SUPER_ADMIN, UserRole.IT_ADMIN, UserRole.PAYROLL_OFFICER];
/** HR reviews old missing fines one by one (deduct or waive). */
const FINE_REVIEW_ROLES = [
  ...FINE_AUDIT_ROLES,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
];

class WaiveFineDto {
  @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

@Controller('fine-audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@StrictRoles()
export class FineAuditController {
  constructor(private service: FineAuditService) {}

  @Get()
  @Roles(...FINE_REVIEW_ROLES)
  audit() {
    return this.service.audit();
  }

  @Post(':letterId/deduct')
  @Roles(...FINE_REVIEW_ROLES)
  deduct(@Param('letterId') letterId: string, @CurrentUser() user: { id: string }) {
    return this.service.deductOne(letterId, user.id);
  }

  @Post(':letterId/waive')
  @Roles(...FINE_REVIEW_ROLES)
  waive(@Param('letterId') letterId: string, @Body() dto: WaiveFineDto, @CurrentUser() user: { id: string }) {
    return this.service.waiveOne(letterId, dto.reason, user.id);
  }
}
