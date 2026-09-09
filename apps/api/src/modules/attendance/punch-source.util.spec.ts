import { AttendanceSource } from '@prisma/client';
import {
  summarizeLegacySource,
  punchSourcesForBiometricCheckIn,
  punchSourcesForBiometricCheckOut,
  punchSourcesForManualCheckIn,
  punchSourcesForHrUpdate,
} from './punch-source.util';

describe('punch-source.util', () => {
  describe('summarizeLegacySource', () => {
    it('returns MANUAL if either punch source is MANUAL', () => {
      expect(
        summarizeLegacySource(
          AttendanceSource.MANUAL,
          AttendanceSource.BIOMETRIC,
          AttendanceSource.BIOMETRIC,
        ),
      ).toBe(AttendanceSource.MANUAL);
    });

    it('returns BIOMETRIC when punch sources are biometric/null', () => {
      expect(
        summarizeLegacySource(
          AttendanceSource.BIOMETRIC,
          null,
          AttendanceSource.MANUAL,
        ),
      ).toBe(AttendanceSource.BIOMETRIC);
    });

    it('keeps previous when both punch sources null', () => {
      expect(
        summarizeLegacySource(null, null, AttendanceSource.MANUAL),
      ).toBe(AttendanceSource.MANUAL);
    });
  });

  describe('punchSourcesForHrUpdate', () => {
    it('sets only checkInSource MANUAL when check-in changes', () => {
      expect(
        punchSourcesForHrUpdate({
          previousCheckIn: new Date('2026-09-08T04:33:00.000Z'),
          previousCheckOut: null,
          previousCheckInSource: AttendanceSource.BIOMETRIC,
          previousCheckOutSource: null,
          previousSource: AttendanceSource.BIOMETRIC,
          nextCheckIn: new Date('2026-09-08T03:00:00.000Z'),
          nextCheckOut: null,
          checkInProvided: true,
          checkOutProvided: false,
        }),
      ).toEqual({
        checkInSource: AttendanceSource.MANUAL,
        source: AttendanceSource.MANUAL,
      });
    });

    it('clears checkOutSource when checkout cleared', () => {
      expect(
        punchSourcesForHrUpdate({
          previousCheckIn: new Date('2026-09-08T03:00:00.000Z'),
          previousCheckOut: new Date('2026-09-08T15:00:00.000Z'),
          previousCheckInSource: AttendanceSource.BIOMETRIC,
          previousCheckOutSource: AttendanceSource.BIOMETRIC,
          previousSource: AttendanceSource.BIOMETRIC,
          nextCheckIn: new Date('2026-09-08T03:00:00.000Z'),
          nextCheckOut: null,
          checkInProvided: false,
          checkOutProvided: true,
        }),
      ).toEqual({
        checkOutSource: null,
        source: AttendanceSource.BIOMETRIC,
      });
    });

    it('does nothing for status-only updates', () => {
      expect(
        punchSourcesForHrUpdate({
          previousCheckIn: new Date('2026-09-08T03:00:00.000Z'),
          previousCheckOut: null,
          previousCheckInSource: AttendanceSource.BIOMETRIC,
          previousCheckOutSource: null,
          previousSource: AttendanceSource.BIOMETRIC,
          nextCheckIn: new Date('2026-09-08T03:00:00.000Z'),
          nextCheckOut: null,
          checkInProvided: false,
          checkOutProvided: false,
        }),
      ).toEqual({});
    });
  });

  it('biometric helpers set expected fields', () => {
    expect(punchSourcesForBiometricCheckIn()).toEqual({
      checkInSource: AttendanceSource.BIOMETRIC,
      source: AttendanceSource.BIOMETRIC,
    });
    expect(punchSourcesForBiometricCheckOut()).toEqual({
      checkOutSource: AttendanceSource.BIOMETRIC,
    });
  });

  it('manual check-in helper sets MANUAL sources', () => {
    expect(punchSourcesForManualCheckIn(false)).toEqual({
      checkInSource: AttendanceSource.MANUAL,
      source: AttendanceSource.MANUAL,
    });
    expect(punchSourcesForManualCheckIn(true)).toEqual({
      checkInSource: AttendanceSource.MANUAL,
      checkOutSource: AttendanceSource.MANUAL,
      source: AttendanceSource.MANUAL,
    });
  });
});
