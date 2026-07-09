const PK_OFFSET_MS = 5 * 60 * 60 * 1000

/** Extract HH:mm in Pakistan time from an ISO datetime */
export function toPakistanTime24(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  const pkDate = new Date(d.getTime() + PK_OFFSET_MS)
  const h = pkDate.getUTCHours()
  const m = pkDate.getUTCMinutes()
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Current HH:mm in Pakistan time */
export function currentPakistanTime24(): string {
  return toPakistanTime24(new Date())
}

/** Today's date (yyyy-MM-dd) in Pakistan time */
export function todayPakistan(): string {
  const pk = new Date(Date.now() + PK_OFFSET_MS)
  const y = pk.getUTCFullYear()
  const mo = String(pk.getUTCMonth() + 1).padStart(2, '0')
  const d = String(pk.getUTCDate()).padStart(2, '0')
  return `${y}-${mo}-${d}`
}

export function to12Hour(time: string): string {
  if (!time) return '—'
  const [h, m] = time.split(':').map(Number)
  const period = h < 12 ? 'AM' : 'PM'
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

export function to24Hour(h: number, m: number, period: string): string {
  let hour = h
  if (period === 'PM' && h !== 12) hour += 12
  if (period === 'AM' && h === 12) hour = 0
  return `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function from24Hour(time: string): {
  hour: number
  minute: number
  period: 'AM' | 'PM'
} {
  const [h24, m] = time.split(':').map(Number)
  const period: 'AM' | 'PM' = h24 < 12 ? 'AM' : 'PM'
  const hour = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24
  return { hour, minute: m, period }
}

/** @deprecated Use to12Hour */
export const formatTime = to12Hour

export function parseAMPM(timeStr: string): string {
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!match) return timeStr
  let h = parseInt(match[1], 10)
  const m = match[2]
  const period = match[3].toUpperCase()
  if (period === 'PM' && h !== 12) h += 12
  if (period === 'AM' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${m}`
}

/** Format ISO datetime or HH:mm string for display (Pakistan time) */
export function formatDateTimeTime(value?: string | null): string {
  if (!value) return '—'
  if (value.includes('T')) {
    return to12Hour(toPakistanTime24(value))
  }
  if (/^\d{2}:\d{2}$/.test(value)) {
    return to12Hour(value)
  }
  return value
}

export function formatDurationSince(checkInIso: string, now = new Date()): string {
  const checkIn = new Date(checkInIso)
  const diffMs = now.getTime() - checkIn.getTime()
  if (diffMs < 0) return '0 mins'
  const totalMins = Math.floor(diffMs / 60000)
  const hrs = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (hrs > 0) return `${hrs} hrs ${mins} mins since check-in`
  return `${mins} mins since check-in`
}
