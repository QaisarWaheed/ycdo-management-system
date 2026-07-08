import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AttendanceSource,
  AttendanceStatus,
  EmployeeStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { applyDisciplineRules } from './discipline.helper';

@Injectable()
export class ShiftAbsentScheduler {
  private readonly logger = new Logger(ShiftAbsentScheduler.name);

  constructor(private prisma: PrismaService) {}

  @Cron('*/15 * * * *')
  async markShiftStartAbsent() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const recentlyStartedShifts = await this.prisma.shift.findMany({
      where: { isActive: true },
    });

    let marked = 0;

    for (const shift of recentlyStartedShifts) {
      const [shiftHour, shiftMin] = shift.startTime.split(':').map(Number);
      const shiftStartMinutes = shiftHour * 60 + shiftMin;

      if (
        nowMinutes < shiftStartMinutes ||
        nowMinutes > shiftStartMinutes + 15
      ) {
        continue;
      }

      const employees = await this.prisma.employee.findMany({
        where: {
          shiftId: shift.id,
          status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.APPOINTED] },
        },
      });

      for (const employee of employees) {
        const existing = await this.prisma.attendanceLog.findUnique({
          where: {
            employeeId_date: {
              employeeId: employee.id,
              date: today,
            },
          },
        });

        if (!existing) {
          await this.prisma.attendanceLog.create({
            data: {
              employeeId: employee.id,
              branchId: employee.currentBranchId,
              date: today,
              status: AttendanceStatus.ABSENT,
              source: AttendanceSource.MANUAL,
              note: 'Auto-marked absent at shift start',
            },
          });
          marked++;
        }
      }
    }

    if (marked > 0) {
      this.logger.log(`Auto-marked ${marked} employee(s) absent at shift start`);
    }
  }

  @Cron('*/15 * * * *')
  async markUninformedAbsent() {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const absentLogs = await this.prisma.attendanceLog.findMany({
      where: {
        date: today,
        status: AttendanceStatus.ABSENT,
        checkIn: null,
        source: AttendanceSource.MANUAL,
        note: 'Auto-marked absent at shift start',
      },
      include: {
        employee: {
          include: {
            shift: true,
          },
        },
      },
    });

    let upgraded = 0;

    for (const log of absentLogs) {
      if (!log.employee.shift) continue;

      const [shiftH, shiftM] = log.employee.shift.startTime
        .split(':')
        .map(Number);
      const shiftStartMinutes = shiftH * 60 + shiftM;
      const minutesSinceShiftStart = currentMinutes - shiftStartMinutes;

      if (minutesSinceShiftStart < 180) continue;

      await this.prisma.$transaction(async (tx) => {
        await tx.attendanceLog.update({
          where: { id: log.id },
          data: { status: AttendanceStatus.UNINFORMED_ABSENT },
        });

        await applyDisciplineRules(
          tx,
          log.employee.id,
          AttendanceStatus.UNINFORMED_ABSENT,
          today,
        );

        await tx.notification.create({
          data: {
            employeeId: log.employee.id,
            message:
              'You have been marked as Uninformed Absent. 2 days stipend deduction applied.',
            type: 'UNINFORMED_ABSENT',
          },
        });
      });

      upgraded++;
    }

    if (upgraded > 0) {
      this.logger.log(
        `Upgraded ${upgraded} employee(s) to uninformed absent after 3 hours`,
      );
    }
  }
}
