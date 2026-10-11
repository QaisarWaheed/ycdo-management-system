import { PayChangeKind } from '@prisma/client';
import { DoctorPerformanceService } from './doctor-performance.service';
import { isDoctorDesignation, previousMonth } from './doctor-performance.util';

describe('doctor performance', () => {
  it('picks doctors by designation category, not LHV / OPD staff', () => {
    expect(isDoctorDesignation('MEDICAL OFFICER', 'OPD')).toBe(true);
    expect(isDoctorDesignation('WOMAN MEDICAL OFFICER', 'OPD')).toBe(true);
    expect(isDoctorDesignation('LHV', 'OPD')).toBe(false);
    expect(isDoctorDesignation('OPD STAFF', 'OPD')).toBe(false);
    expect(isDoctorDesignation('DENTIST', 'CONSULTANT')).toBe(true);
    expect(isDoctorDesignation('SURGEON', 'SURGICAL  DEPARTMENT')).toBe(true);
    expect(isDoctorDesignation('OPERATION THEATER ASSISTANT', 'SURGICAL  DEPARTMENT')).toBe(false);
    expect(isDoctorDesignation('SWEEPER', 'GRADE 4')).toBe(false);
  });

  it('previous month wraps the year', () => {
    expect(previousMonth(2026, 1)).toEqual({ year: 2025, month: 12 });
    expect(previousMonth(2026, 10)).toEqual({ year: 2026, month: 9 });
  });

  function build() {
    const prisma = {
      designation: {
        findMany: jest.fn().mockResolvedValue([
          { title: 'MEDICAL OFFICER', category: 'OPD' },
          { title: 'LHV', category: 'OPD' },
        ]),
      },
      employee: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'd1',
            fullName: 'Dr A',
            employeeCode: 'Y-1',
            currentDesignation: 'MEDICAL OFFICER',
            status: 'ACTIVE',
            currentBranch: { id: 'b1', name: 'Central' },
          },
        ]),
      },
      doctorMonthlyPerformance: {
        findMany: jest.fn().mockResolvedValue([
          { employeeId: 'd1', year: 2026, month: 10, opdPatients: 950, indoorPatients: 40, surgeries: 3, labTests: 210, collection: 450000, note: null },
          { employeeId: 'd1', year: 2026, month: 9, opdPatients: 820, indoorPatients: 35, surgeries: 2, labTests: 180, collection: 390000, note: null },
        ]),
        upsert: jest.fn(),
      },
      incentive: {
        findMany: jest.fn().mockResolvedValue([
          { employeeId: 'd1', amount: 5000, reason: 'On Progress', type: { name: 'On Progress' } },
        ]),
      },
      payChangeRequest: {
        findMany: jest.fn().mockResolvedValue([
          { employeeId: 'd1', payload: { month: 10, year: 2026, amount: 2000 }, summary: 'Incentive (Private Room) 2,000 for Oct 2026' },
          { employeeId: 'd1', payload: { month: 9, year: 2026, amount: 999 }, summary: 'other month' },
        ]),
      },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (ops: unknown[]) => ops),
    };
    return { prisma, service: new DoctorPerformanceService(prisma as never) };
  }

  it('lists doctors with this month, last month and incentives (approved + pending)', async () => {
    const { prisma, service } = build();
    const res = await service.list(2026, 10);
    expect(prisma.employee.findMany.mock.calls[0][0].where.currentDesignation).toEqual({
      in: ['MEDICAL OFFICER'],
    });
    expect(prisma.payChangeRequest.findMany.mock.calls[0][0].where.kind).toBe(PayChangeKind.INCENTIVE);
    expect(res.previous).toEqual({ year: 2026, month: 9 });
    expect(res.rows[0]).toMatchObject({
      employee: { fullName: 'Dr A', designation: 'MEDICAL OFFICER', branch: 'Central' },
      current: { opdPatients: 950, collection: 450000 },
      previous: { opdPatients: 820, collection: 390000 },
      incentives: [
        { name: 'On Progress', amount: 5000, pending: false },
        { amount: 2000, pending: true },
      ],
    });
    expect(res.rows[0].incentives).toHaveLength(2);
  });

  it('saves figures only for doctors and records who saved them', async () => {
    const { prisma, service } = build();
    prisma.employee.findMany.mockResolvedValueOnce([]);
    await expect(
      service.save(2026, 10, [{ employeeId: 'x', opdPatients: 1, indoorPatients: 0, surgeries: 0, labTests: 0, collection: 0 }], { id: 'fin' }),
    ).rejects.toThrow('only be saved for doctors');

    prisma.employee.findMany.mockResolvedValueOnce([{ id: 'd1' }]);
    await service.save(2026, 10, [{ employeeId: 'd1', opdPatients: 950, indoorPatients: 40, surgeries: 3, labTests: 210, collection: 450000, note: ' ' }], { id: 'fin' });
    expect(prisma.doctorMonthlyPerformance.upsert).toHaveBeenCalledWith({
      where: { employeeId_year_month: { employeeId: 'd1', year: 2026, month: 10 } },
      create: expect.objectContaining({ employeeId: 'd1', opdPatients: 950, labTests: 210, note: null, updatedById: 'fin' }),
      update: expect.objectContaining({ opdPatients: 950, collection: 450000 }),
    });
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('DOCTOR_PERFORMANCE_SAVED');
  });
});
