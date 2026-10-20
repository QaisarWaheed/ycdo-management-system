import { LettersService } from './letters.service';

/** Missing checkout: 1 day per 3 incidents, so reversing one may not return money. */
describe('LettersService.reverseImpact', () => {
  function make(monthCount: number, letterVars: Record<string, unknown>) {
    const prisma = {
      letter: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ employeeId: 'e1', variables: letterVars }),
      },
      disciplineEvent: {
        count: jest.fn(({ where }: { where: { incidentDate: unknown } }) =>
          Promise.resolve(where.incidentDate instanceof Date ? 1 : monthCount),
        ),
      },
    };
    const service = Object.create(LettersService.prototype) as LettersService;
    Object.assign(service, { prisma });
    return service;
  }
  const mc = {
    disciplineCategory: 'MISSING_CHECKOUT',
    incidentDate: '2026-10-14',
  };

  it('3 incidents: reversing one takes the deduction from 1 day to 0', async () => {
    await expect(make(3, mc).reverseImpact('l1')).resolves.toMatchObject({
      incidentsBefore: 3,
      incidentsAfter: 2,
      daysBefore: 1,
      daysAfter: 0,
    });
  });

  it('4 incidents: reversing the fine letter still leaves 1 day', async () => {
    await expect(make(4, mc).reverseImpact('l1')).resolves.toMatchObject({
      incidentsAfter: 3,
      daysBefore: 1,
      daysAfter: 1,
    });
  });

  it('other letters have no impact info', async () => {
    await expect(
      make(4, { incidentDate: '2026-10-14' }).reverseImpact('l1'),
    ).resolves.toBeNull();
  });
});
