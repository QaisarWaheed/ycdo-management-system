import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AttendanceSource,
  AttendanceStatus,
  EmployeeStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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
}
