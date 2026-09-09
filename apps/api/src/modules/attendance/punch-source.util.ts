import { AttendanceSource } from '@prisma/client';

export function summarizeLegacySource(
  checkInSource: AttendanceSource | null | undefined,
  checkOutSource: AttendanceSource | null | undefined,
  previousSource: AttendanceSource,
): AttendanceSource {
  if (
    checkInSource === AttendanceSource.MANUAL ||
    checkOutSource === AttendanceSource.MANUAL
  ) {
    return AttendanceSource.MANUAL;
  }
  if (
    checkInSource === AttendanceSource.BIOMETRIC ||
    checkOutSource === AttendanceSource.BIOMETRIC
  ) {
    return AttendanceSource.BIOMETRIC;
  }
  return previousSource;
}

export function punchSourcesForBiometricCheckIn() {
  return {
    checkInSource: AttendanceSource.BIOMETRIC,
    source: AttendanceSource.BIOMETRIC,
  } as const;
}

export function punchSourcesForBiometricCheckOut() {
  return {
    checkOutSource: AttendanceSource.BIOMETRIC,
  } as const;
}

export function punchSourcesForManualCheckIn(hasCheckOut: boolean) {
  if (hasCheckOut) {
    return {
      checkInSource: AttendanceSource.MANUAL,
      checkOutSource: AttendanceSource.MANUAL,
      source: AttendanceSource.MANUAL,
    } as const;
  }
  return {
    checkInSource: AttendanceSource.MANUAL,
    source: AttendanceSource.MANUAL,
  } as const;
}

export function punchSourcesForHrUpdate(args: {
  previousCheckIn: Date | null;
  previousCheckOut: Date | null;
  previousCheckInSource: AttendanceSource | null;
  previousCheckOutSource: AttendanceSource | null;
  previousSource: AttendanceSource;
  nextCheckIn: Date | null;
  nextCheckOut: Date | null;
  checkInProvided: boolean;
  checkOutProvided: boolean;
}): Partial<{
  checkInSource: AttendanceSource | null;
  checkOutSource: AttendanceSource | null;
  source: AttendanceSource;
}> {
  const out: Partial<{
    checkInSource: AttendanceSource | null;
    checkOutSource: AttendanceSource | null;
    source: AttendanceSource;
  }> = {};

  let nextInSrc = args.previousCheckInSource;
  let nextOutSrc = args.previousCheckOutSource;
  let touched = false;

  if (args.checkInProvided) {
    touched = true;
    if (args.nextCheckIn == null) {
      nextInSrc = null;
      out.checkInSource = null;
    } else {
      const changed =
        args.previousCheckIn?.getTime() !== args.nextCheckIn.getTime();
      if (changed || args.previousCheckIn == null) {
        nextInSrc = AttendanceSource.MANUAL;
        out.checkInSource = AttendanceSource.MANUAL;
      }
    }
  }

  if (args.checkOutProvided) {
    touched = true;
    if (args.nextCheckOut == null) {
      nextOutSrc = null;
      out.checkOutSource = null;
    } else {
      const changed =
        args.previousCheckOut?.getTime() !== args.nextCheckOut.getTime();
      if (changed || args.previousCheckOut == null) {
        nextOutSrc = AttendanceSource.MANUAL;
        out.checkOutSource = AttendanceSource.MANUAL;
      }
    }
  }

  // Clearing check-in also clears checkout in updateAttendance — mirror sources.
  if (args.checkInProvided && args.nextCheckIn == null) {
    nextOutSrc = null;
    out.checkOutSource = null;
  }

  if (touched) {
    out.source = summarizeLegacySource(
      nextInSrc,
      nextOutSrc,
      args.previousSource,
    );
  }

  return out;
}
