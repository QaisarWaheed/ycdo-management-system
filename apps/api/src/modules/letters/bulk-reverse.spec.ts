import { Candidate, matchesRule } from './bulk-reverse.service';

const c = (over: Partial<Candidate> = {}): Candidate => ({
  id: 'l1',
  letterNo: null,
  letterType: 'WARNING',
  employeeId: 'e1',
  employeeCode: 'YCDO-2026-0215',
  employeeName: 'Liaqat Abbas',
  branch: 'Allah Dad Memorial YCDO Hospital',
  incidentDate: '2026-10-15',
  ...over,
});

describe('bulk reverse rule matching', () => {
  it('branch + range', () => {
    expect(matchesRule(c(), { branch: 'Allah Dad Memorial YCDO Hospital', from: '2026-09-01', to: '2026-10-31' })).toBe(true);
    expect(matchesRule(c(), { branch: 'YCDO Head Office' })).toBe(false);
    expect(matchesRule(c({ incidentDate: '2026-10-15' }), { to: '2026-10-14' })).toBe(false);
  });
  it('short codes and exact dates', () => {
    expect(matchesRule(c(), { employeeCodes: ['0215'], dates: ['2026-10-15'] })).toBe(true);
    expect(matchesRule(c(), { employeeCodes: ['0215'], dates: ['2026-10-16'] })).toBe(false);
  });
  it('exclusions and letters without an incident date', () => {
    expect(matchesRule(c(), { branch: 'Allah Dad Memorial YCDO Hospital', excludeEmployeeCodes: ['0215'] })).toBe(false);
    expect(matchesRule(c({ incidentDate: null }), {})).toBe(false);
  });
});
