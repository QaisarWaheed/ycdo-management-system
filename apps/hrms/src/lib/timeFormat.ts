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

/** Shift a yyyy-MM-dd calendar date by N days (Pakistan civil date). */
export function pakistanDateOffset(days: number, from = todayPakistan()): string {
  const [y, m, d] = from.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + days))
  const yy = next.getUTCFullYear()
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(next.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** Display yyyy-MM-dd (or ISO date) as DD MMM YYYY */
export function formatPakistanDate(value?: string | null): string {
  if (!value) return '—'
  const date = value.slice(0, 10)
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  return `${String(d).padStart(2, '0')} ${months[m - 1]} ${y}`
}

export function to12Hour(time: string): string {
  if (!time) return '—'
  const normalized = time.trim().substring(0, 5)
  const [hours, minutes] = normalized.split(':').map(Number)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return '—'
  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHour = hours % 12 || 12
  return `${String(displayHour).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${period}`
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

/** Format a UTC ISO datetime as hh:mm AM/PM in Pakistan time (Asia/Karachi) */
export function formatPKT(utcDate?: string | Date | null): string {
  if (!utcDate) return '--'
  const date = typeof utcDate === 'string' ? new Date(utcDate) : utcDate
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleTimeString('en-PK', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

/** Format ISO datetime or HH:mm string for display (Pakistan time) */
export function formatDateTimeTime(value?: string | null): string {
  if (!value) return '—'
  if (value.includes('T')) {
    return formatPKT(value)
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
