// attendance.service.ts imports discipline.helper.ts, which imports
// issueAutoTemplatedLetter at module scope, which transitively pulls in
// puppeteer (ESM-only, breaks Jest's default CommonJS transform). Stub the
// module boundary — same pattern as every discipline spec in this directory.
jest.mock('./../letters/auto-letter.helper', () => ({
  issueAutoTemplatedLetter: jest.fn().mockResolvedValue(undefined),
}));

import { AttendanceService } from './attendance.service';

/**
 * Coverage for the RelieverSession correction overlap-validation fix
 * (updateRelieverSession, PATCH /attendance/reliever-sessions/:id).
 *
 * Root cause: the overlap query excluded the session being edited
 * (`id: { not: session.id }` was already present — self-comparison was
 * NOT the bug) but had NO date scoping at all, comparing a correction
 * against the reliever's entire session history. A stale/abandoned OPEN
 * session (checkOut: null) on a completely unrelated date is always
 * treated as "ambiguous" by the open-session branch of the overlap test,
 * and a corrected checkout time is almost always later than that stale
 * session's checkIn — so it alone was enough to reject every correction
 * with a false "overlap" error, matching the reported production symptom
 * for Dr Humna Ahmed (2026-08-18, sessionId 80bfaa4c-8a7b-4d1f-901e-
 * 0d93f4a886eb) even though only one session existed on that date.
 *
 * Fix: scope the overlap query to a ±1-day window around the session's
 * own `date` field — narrow enough to exclude unrelated history, wide
 * enough that the existing (unmodified) real-timestamp overlap math still
 * correctly catches a genuine cross-midnight conflict against an adjacent
 * day's session.
 */

const EMP_ID = 'emp-reliever-1';
const SESSION_ID = 'session-under-edit';
const ACTING_USER = { id: 'user-1', role: 'HR_MANAGER' as any };

/** Plain UTC date, used only for RelieverSession.date (a calendar-day
 * label, not part of the overlap timestamp math itself). */
function utc(y: number, m: number, d: number, h = 0, min = 0) {
  return new Date(Date.UTC(y, m, d, h, min, 0));
}

/** PKT wall-clock instant, matching parseAttendanceDateTime's own
 * "no explicit offset -> assume +05:00" convention — used for every
 * checkIn/checkOut fixture so they land on the exact same absolute
 * instant as the offset-less ISO strings passed to updateRelieverSession's
 * dto in these tests. */
function pkt(y: number, m: number, d: number, h: number, min = 0) {
  return new Date(Date.UTC(y, m, d, h - 5, min, 0));
}

function makeService(opts: {
  session: any;
  otherSessions: Array<{ checkIn: Date; checkOut: Date | null }>;
}) {
  const findManyCall = jest.fn().mockResolvedValue(opts.otherSessions);
  const tx = {
    relieverSession: {
      update: jest.fn().mockImplementation((args: any) => ({
        id: SESSION_ID,
        employeeId: EMP_ID,
        ...args.data,
      })),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    relieverSession: {
      findUnique: jest.fn().mockResolvedValue(opts.session),
      findMany: findManyCall,
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const permissionsService = {};
  const accessScopeService = {};
  const payrollService = {
    recomputePendingPayrollForAttendanceDate: jest.fn().mockResolvedValue(undefined),
  };

  const service = new AttendanceService(
    prisma as any,
    permissionsService as any,
    accessScopeService as any,
    payrollService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { upsertFromRelieverSession: jest.fn().mockResolvedValue(null) } as any,
  );

  return { service, prisma, tx, findManyCall };
}

describe('AttendanceService.updateRelieverSession — overlap validation', () => {
  // 1. Correcting a session with no other sessions at all succeeds.
  it('1: correcting a session with no other RelieverSession rows succeeds', async () => {
    const session = {
      id: SESSION_ID,
      employeeId: EMP_ID,
      date: utc(2026, 7, 18),
      checkIn: pkt(2026, 7, 18, 13, 8),
      checkOut: pkt(2026, 7, 18, 14, 35),
      totalMinutes: 87,
    };
    const { service, tx } = makeService({ session, otherSessions: [] });

    const result = await service.updateRelieverSession(
      SESSION_ID,
      { checkIn: '2026-08-18T13:10:00', checkOut: '2026-08-18T14:40:00' },
      ACTING_USER,
    );

    expect(tx.relieverSession.update).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
  });

  // 2. A genuinely overlapping OTHER session (same date) is rejected.
  it('2: a genuinely overlapping other session on the same date is rejected', async () => {
    const session = {
      id: SESSION_ID,
      employeeId: EMP_ID,
      date: utc(2026, 7, 18),
      checkIn: pkt(2026, 7, 18, 13, 8),
      checkOut: pkt(2026, 7, 18, 14, 35),
      totalMinutes: 87,
    };
    const otherSessions = [
      { checkIn: pkt(2026, 7, 18, 14, 0), checkOut: pkt(2026, 7, 18, 15, 0) },
    ];
    const { service } = makeService({ session, otherSessions });

    // Corrected to 13:30-14:30, which overlaps the other 14:00-15:00 session.
    await expect(
      service.updateRelieverSession(
        SESSION_ID,
        { checkIn: '2026-08-18T13:30:00', checkOut: '2026-08-18T14:30:00' },
        ACTING_USER,
      ),
    ).rejects.toThrow('Corrected times overlap another recorded Reliever session for this employee');
  });

  // 3. The current session never conflicts with itself (id exclusion
  // still holds — this was already correct before the fix, verified here
  // as an explicit regression guard).
  it('3: the session being edited never conflicts with itself even though findMany would otherwise return it', async () => {
    const session = {
      id: SESSION_ID,
      employeeId: EMP_ID,
      date: utc(2026, 7, 18),
      checkIn: pkt(2026, 7, 18, 13, 8),
      checkOut: pkt(2026, 7, 18, 14, 35),
      totalMinutes: 87,
    };
    const { service, findManyCall } = makeService({ session, otherSessions: [] });

    await service.updateRelieverSession(
      SESSION_ID,
      { checkIn: '2026-08-18T13:10:00' },
      ACTING_USER,
    );

    const whereArg = findManyCall.mock.calls[0][0].where;
    expect(whereArg.id).toEqual({ not: SESSION_ID });
  });

  // 4. Adjacent (touching, non-overlapping) sessions are allowed.
  it('4: adjacent sessions (13:00-14:00 and 14:00-15:00) are allowed', async () => {
    const session = {
      id: SESSION_ID,
      employeeId: EMP_ID,
      date: utc(2026, 7, 18),
      checkIn: pkt(2026, 7, 18, 12, 0),
      checkOut: pkt(2026, 7, 18, 13, 0),
      totalMinutes: 60,
    };
    const otherSessions = [
      { checkIn: pkt(2026, 7, 18, 14, 0), checkOut: pkt(2026, 7, 18, 15, 0) },
    ];
    const { service, tx } = makeService({ session, otherSessions });

    await service.updateRelieverSession(
      SESSION_ID,
      { checkIn: '2026-08-18T13:00:00', checkOut: '2026-08-18T14:00:00' },
      ACTING_USER,
    );

    expect(tx.relieverSession.update).toHaveBeenCalledTimes(1);
  });

  // 5. Cross-midnight overlap behavior remains correct — a genuine overlap
  // against an ADJACENT DAY's session (different `date` label) must still
  // be caught by the ±1-day window, not silently missed.
  it('5: a genuine cross-midnight overlap against an adjacent day is still caught', async () => {
    const session = {
      id: SESSION_ID,
      employeeId: EMP_ID,
      date: utc(2026, 7, 18), // labeled Aug 18
      checkIn: pkt(2026, 7, 18, 22, 0),
      checkOut: pkt(2026, 7, 19, 2, 0), // crosses into Aug 19
      totalMinutes: 240,
    };
    // Other session is labeled Aug 19 but starts at 01:00 Aug 19 — overlaps
    // the corrected session's 22:00 Aug18 -> 03:00 Aug19 window.
    const otherSessions = [
      { checkIn: pkt(2026, 7, 19, 1, 0), checkOut: pkt(2026, 7, 19, 4, 0) },
    ];
    const { service } = makeService({ session, otherSessions });

    await expect(
      service.updateRelieverSession(
        SESSION_ID,
        { checkOut: '2026-08-19T03:00:00' }, // extends to 03:00, now overlapping
        ACTING_USER,
      ),
    ).rejects.toThrow('Corrected times overlap another recorded Reliever session for this employee');
  });

  // 5b. Cross-midnight, non-overlapping: correcting a session that
  // genuinely crosses midnight with NO real conflict still succeeds.
  it('5b: a cross-midnight session with no real conflict against an adjacent day still succeeds', async () => {
    const session = {
      id: SESSION_ID,
      employeeId: EMP_ID,
      date: utc(2026, 7, 18),
      checkIn: pkt(2026, 7, 18, 22, 0),
      checkOut: pkt(2026, 7, 19, 2, 0),
      totalMinutes: 240,
    };
    const otherSessions = [
      // Adjacent-day session starting well after this one ends — no overlap.
      { checkIn: pkt(2026, 7, 19, 6, 0), checkOut: pkt(2026, 7, 19, 8, 0) },
    ];
    const { service, tx } = makeService({ session, otherSessions });

    await service.updateRelieverSession(
      SESSION_ID,
      { checkOut: '2026-08-19T02:00:00' },
      ACTING_USER,
    );

    expect(tx.relieverSession.update).toHaveBeenCalledTimes(1);
  });

  // THE PRODUCTION BUG: a stale/abandoned OPEN session on a completely
  // unrelated, far-away date must never block a correction to a session on
  // a different date — this is exactly what was happening before the fix.
  it('BUG REPRODUCTION: a stale open session from an unrelated, far-away date no longer blocks the correction', async () => {
    const session = {
      id: SESSION_ID,
      employeeId: EMP_ID,
      date: utc(2026, 7, 18),
      checkIn: pkt(2026, 7, 18, 13, 8),
      checkOut: pkt(2026, 7, 18, 14, 35),
      totalMinutes: 87,
    };
    // A stale, still-open session from March — months away, never closed.
    // With the OLD unscoped query this would ALWAYS trip the open-session
    // "ambiguous" branch, since any corrected checkout is later than this
    // session's checkIn.
    const staleOpenSession = { checkIn: pkt(2026, 2, 3, 9, 0), checkOut: null };
    // The findMany mock below simulates the FIXED, date-scoped query — it
    // must NOT be asked to return this stale row once date-scoping is
    // applied, proving the query itself now excludes it.
    const findManyCall = jest.fn().mockImplementation(({ where }: any) => {
      const inWindow =
        where.date.gte.getTime() <= staleOpenSession.checkIn.getTime() &&
        staleOpenSession.checkIn.getTime() <= where.date.lte.getTime();
      return Promise.resolve(inWindow ? [staleOpenSession] : []);
    });
    const tx = {
      relieverSession: {
        update: jest.fn().mockImplementation((args: any) => ({ id: SESSION_ID, ...args.data })),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      relieverSession: { findUnique: jest.fn().mockResolvedValue(session), findMany: findManyCall },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const payrollService = { recomputePendingPayrollForAttendanceDate: jest.fn().mockResolvedValue(undefined) };
    const service = new AttendanceService(
      prisma as any,
      {} as any,
      {} as any,
      payrollService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { upsertFromRelieverSession: jest.fn().mockResolvedValue(null) } as any,
    );

    await service.updateRelieverSession(
      SESSION_ID,
      { checkIn: '2026-08-18T13:08:27', checkOut: '2026-08-18T14:35:32' },
      ACTING_USER,
    );

    expect(tx.relieverSession.update).toHaveBeenCalledTimes(1); // succeeded, not rejected
    // Confirms the query itself was scoped to exclude the far-away date —
    // the mock's window check never matched the March session.
    const whereArg = findManyCall.mock.calls[0][0].where;
    expect(
      whereArg.date.gte.getTime() <= staleOpenSession.checkIn.getTime() &&
        staleOpenSession.checkIn.getTime() <= whereArg.date.lte.getTime(),
    ).toBe(false);
  });
});
