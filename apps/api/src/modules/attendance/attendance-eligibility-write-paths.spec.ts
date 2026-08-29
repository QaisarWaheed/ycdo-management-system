jest.mock('../letters/auto-letter.helper', () => ({
  issueAutoTemplatedLetter: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../letters/letters.service', () => ({
  LettersService: class LettersService {},
}));
jest.mock('../disciplinary/disciplinary.service', () => ({
  DisciplinaryService: class DisciplinaryService {},
}));

import { BadRequestException } from '@nestjs/common';
import { EmployeeStatus, UserRole } from '@prisma/client';
import { AttendanceService } from './attendance.service';

function makeService(employeeStatus: EmployeeStatus) {
  const prisma = {
    attendanceLog: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'log-1',
        employee: { status: employeeStatus },
      }),
      update: jest.fn().mockResolvedValue({ id: 'log-1' }),
    },
    relieverSession: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'sess-1',
        employeeId: 'emp-1',
        checkIn: new Date(),
        checkOut: null,
        date: new Date(),
        employee: { status: employeeStatus },
      }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const service = new AttendanceService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { upsertFromRelieverSession: jest.fn() } as never,
  );

  return { service, prisma };
}

describe('AttendanceService remaining write-path eligibility', () => {
  it('approveOvertime rejects PENDING_APPROVAL', async () => {
    const { service, prisma } = makeService(EmployeeStatus.PENDING_APPROVAL);

    await expect(
      service.approveOvertime('log-1', { overtimeMinutes: 30 }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.attendanceLog.update).not.toHaveBeenCalled();
  });

  it('relieverCheckOut rejects APPOINTED', async () => {
    const { service, prisma } = makeService(EmployeeStatus.APPOINTED);

    await expect(
      service.relieverCheckOut({ sessionId: 'sess-1' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.relieverSession.update).not.toHaveBeenCalled();
  });

  it('updateRelieverSession rejects PENDING_APPROVAL', async () => {
    const { service, prisma } = makeService(EmployeeStatus.PENDING_APPROVAL);

    await expect(
      service.updateRelieverSession(
        'sess-1',
        { checkOut: new Date().toISOString() },
        { id: 'user-1', role: UserRole.HR_MANAGER },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
