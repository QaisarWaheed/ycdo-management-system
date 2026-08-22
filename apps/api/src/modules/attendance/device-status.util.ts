/**
 * Server-side raw device status resolution for POST /attendance/raw-scan.
 *
 * This is a direct port of biometric_script/agent.py's map_punch_type() /
 * map_status_value() / STATUS_TO_PUNCH / STATUS_VALUE_TO_LABEL — the same
 * mapping table already proven against production devices, moved server-side
 * so the thin agent no longer needs to interpret device status itself.
 */

export type ResolvedPunchType =
  | 'CHECKIN'
  | 'CHECKOUT'
  | 'OVERTIME_CHECKIN'
  | 'OVERTIME_CHECKOUT';

const STATUS_TO_PUNCH: Record<string, ResolvedPunchType> = {
  checkin: 'CHECKIN',
  checkout: 'CHECKOUT',
  overtimein: 'OVERTIME_CHECKIN',
  overtimecheckin: 'OVERTIME_CHECKIN',
  overtimeout: 'OVERTIME_CHECKOUT',
  overtimecheckout: 'OVERTIME_CHECKOUT',
};

/** Hikvision numeric statusValue -> canonical label (mirrors agent.py). */
const STATUS_VALUE_TO_LABEL: Record<number, string> = {
  1: 'checkIn',
  2: 'checkOut',
  3: 'breakOut', // treated as CHECKOUT
  4: 'breakIn', // treated as CHECKIN
  5: 'overtimeIn',
  6: 'overtimeOut',
};

/**
 * Resolve a raw device-reported status (a label like "checkIn"/"CheckOut",
 * or a numeric code sent as a string) to a punch type. Returns null when the
 * status is missing or unrecognised — callers should fall back to AUTO in
 * that case, never guess a specific type.
 */
export function mapDeviceStatusToPunchType(
  deviceStatus: string | null | undefined,
): ResolvedPunchType | null {
  if (!deviceStatus) return null;
  const raw = deviceStatus.trim();
  if (
    !raw ||
    ['undefined', 'unknown', 'null', 'none'].includes(raw.toLowerCase())
  ) {
    return null;
  }

  if (/^\d+$/.test(raw)) {
    const label = STATUS_VALUE_TO_LABEL[Number(raw)];
    return label ? mapDeviceStatusToPunchType(label) : null;
  }

  const key = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (key in STATUS_TO_PUNCH) {
    return STATUS_TO_PUNCH[key];
  }

  // Fuzzy fallback — same rules as agent.py's map_punch_type().
  if (
    key.includes('checkout') ||
    (key.includes('check') && key.includes('out'))
  ) {
    return 'CHECKOUT';
  }
  if (
    key.includes('checkin') ||
    (key.includes('check') && key.includes('in') && !key.includes('out'))
  ) {
    return 'CHECKIN';
  }
  if (key.includes('overtime') && key.includes('out')) {
    return 'OVERTIME_CHECKOUT';
  }
  if (key.includes('overtime') && key.includes('in')) {
    return 'OVERTIME_CHECKIN';
  }

  return null;
}
