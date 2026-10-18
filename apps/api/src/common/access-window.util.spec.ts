import { UserRole } from '@prisma/client';
import { accessWindowError } from './access-window.util';

describe('Req 20 access window', () => {
  const win = { accessFrom: new Date('2026-10-01T09:00:00Z'), accessUntil: new Date('2026-10-31T17:00:00Z') };
  it('allows inside, refuses before and after', () => {
    expect(accessWindowError(win, [UserRole.HR_MANAGER], new Date('2026-10-10T00:00:00Z'))).toBeNull();
    expect(accessWindowError(win, [UserRole.HR_MANAGER], new Date('2026-09-30T00:00:00Z'))).toMatch(/starts/);
    expect(accessWindowError(win, [UserRole.HR_MANAGER], new Date('2026-10-31T17:00:01Z'))).toMatch(/ended/);
  });
  it('executives and open windows are never limited', () => {
    expect(accessWindowError(win, [UserRole.FOUNDER], new Date('2027-01-01T00:00:00Z'))).toBeNull();
    expect(accessWindowError({}, [UserRole.EMPLOYEE])).toBeNull();
  });
});
