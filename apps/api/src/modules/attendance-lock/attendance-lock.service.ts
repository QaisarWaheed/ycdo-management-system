import { BadRequestException, Injectable } from '@nestjs/common';
import { AttendanceMonthStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isMonthOver, monthName } from './attendance-month-lock.util';

type Actor = { id: string };

/** HR verifies (locks) a branch's attendance month; IT unlocks with a reason. */
@Injectable()
export class AttendanceLockService {
  constructor(private prisma: PrismaService) {}

  /** Every branch with its lock status for the month. */
  async list(year: number, month: number) {
    const [branches, locks] = await Promise.all([
      this.prisma.branch.findMany({
        select: { id: true, name: true, abbreviation: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.attendanceMonthLock.findMany({ where: { year, month } }),
    ]);
    const userIds = [
      ...new Set(locks.flatMap((l) => [l.verifiedById, l.unlockedById]).filter(Boolean)),
    ] as string[];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, employee: { select: { fullName: true } } },
    });
    const nameOf = (id?: string | null) => {
      const u = users.find((x) => x.id === id);
      return u ? (u.employee?.fullName ?? u.email) : null;
    };
    const byBranch = new Map(locks.map((l) => [l.branchId, l]));
    return {
      year,
      month,
      canVerify: isMonthOver(year, month),
      branches: branches.map((b) => {
        const lock = byBranch.get(b.id);
        return {
          ...b,
          status: lock?.status ?? null,
          verifiedBy: nameOf(lock?.verifiedById),
          verifiedAt: lock?.verifiedAt ?? null,
          unlockedBy: nameOf(lock?.unlockedById),
          unlockedAt: lock?.unlockedAt ?? null,
          unlockReason: lock?.unlockReason ?? null,
        };
      }),
    };
  }

  async verify(branchIds: string[], year: number, month: number, user: Actor) {
    if (!isMonthOver(year, month)) {
      throw new BadRequestException(
        `${monthName(year, month)} is not over yet; verify it from the 1st of next month`,
      );
    }
    const now = new Date();
    for (const branchId of new Set(branchIds)) {
      await this.prisma.attendanceMonthLock.upsert({
        where: { branchId_year_month: { branchId, year, month } },
        create: {
          branchId,
          year,
          month,
          status: AttendanceMonthStatus.VERIFIED,
          verifiedById: user.id,
          verifiedAt: now,
        },
        update: {
          status: AttendanceMonthStatus.VERIFIED,
          verifiedById: user.id,
          verifiedAt: now,
        },
      });
      await this.audit(user, 'ATTENDANCE_MONTH_VERIFIED', branchId, { year, month });
    }
    return this.list(year, month);
  }

  async unlock(branchId: string, year: number, month: number, reason: string, user: Actor) {
    const lock = await this.prisma.attendanceMonthLock.findUnique({
      where: { branchId_year_month: { branchId, year, month } },
    });
    if (lock?.status !== AttendanceMonthStatus.VERIFIED) {
      throw new BadRequestException('This branch month is not locked');
    }
    await this.prisma.attendanceMonthLock.update({
      where: { id: lock.id },
      data: {
        status: AttendanceMonthStatus.UNLOCKED,
        unlockedById: user.id,
        unlockedAt: new Date(),
        unlockReason: reason.trim(),
      },
    });
    await this.audit(user, 'ATTENDANCE_MONTH_UNLOCKED', branchId, {
      year,
      month,
      reason: reason.trim(),
      verifiedById: lock.verifiedById,
    });
    return this.list(year, month);
  }

  private async audit(
    user: Actor,
    action: string,
    branchId: string,
    changes: Record<string, unknown>,
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action,
        entity: 'AttendanceMonthLock',
        entityId: branchId,
        changes: changes as object,
      },
    });
  }
}
