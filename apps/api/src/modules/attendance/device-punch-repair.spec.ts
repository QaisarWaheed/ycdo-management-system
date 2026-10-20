import { AttendanceService } from './attendance.service';

/** Masoom Shah 19 Oct: punch 08:09:22 (device 4 min fast) saved at its 08:50 arrival. */
describe('repairDelayedDevicePunches', () => {
  const processedAt = new Date('2026-10-19T08:50:07+05:00');
  const savedCheckIn = new Date('2026-10-19T08:50:04+05:00');

  function makeService() {
    const prisma = {
      processedDeviceEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            employeeId: 'emp-63',
            punchType: 'CHECKIN',
            deviceTime: new Date('2026-10-19T08:09:22+05:00'),
            processedAt,
          },
          {
            // Live punch: not delayed, untouched.
            employeeId: 'emp-92',
            punchType: 'CHECKIN',
            deviceTime: new Date('2026-10-19T09:11:20+05:00'),
            processedAt: new Date('2026-10-19T09:07:04+05:00'),
          },
        ]),
      },
      attendanceLog: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'log-63',
          checkIn: savedCheckIn,
          employee: {
            fullName: 'Dr Ayesha Farooq',
            employeeCode: 'YCDO-2026-0132',
          },
        }),
      },
    };
    const service = Object.create(
      AttendanceService.prototype,
    ) as AttendanceService;
    Object.assign(service, { prisma });
    const update = jest
      .spyOn(service, 'updateAttendance')
      .mockResolvedValue({} as never);
    return { service, update, prisma };
  }

  const admin = { id: 'sa', role: 'SUPER_ADMIN' as never };

  it('lists the delayed punch with its device time corrected by the clock error', async () => {
    const { service, update, prisma } = makeService();
    const res = await service.repairDelayedDevicePunches(
      { deviceId: 'masoom shah', date: '2026-10-19', offsetSec: -253 },
      admin,
    );
    expect(res.count).toBe(1);
    expect(res.items[0]).toMatchObject({
      logId: 'log-63',
      field: 'checkIn',
      from: savedCheckIn,
      to: new Date('2026-10-19T08:05:09+05:00'),
    });
    expect(prisma.attendanceLog.findFirst).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('applies through the normal HR edit when asked', async () => {
    const { service, update } = makeService();
    const res = await service.repairDelayedDevicePunches(
      {
        deviceId: 'masoom shah',
        date: '2026-10-19',
        offsetSec: -253,
        apply: true,
      },
      admin,
    );
    expect(update).toHaveBeenCalledWith(
      'log-63',
      expect.objectContaining({ checkIn: '2026-10-19T03:05:09.000Z' }),
      admin,
    );
    expect(res.items[0].result).toBe('fixed');
  });
});
