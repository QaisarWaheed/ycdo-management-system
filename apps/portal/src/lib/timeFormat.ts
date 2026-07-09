export function formatTime(time: string): string {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  const period = h < 12 ? 'AM' : 'PM'
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

const PK_OFFSET_MS = 5 * 60 * 60 * 1000

function toPakistanTime24(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  const pkDate = new Date(d.getTime() + PK_OFFSET_MS)
  const h = pkDate.getUTCHours()
  const m = pkDate.getUTCMinutes()
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function formatDateTimeTime(value?: string | null): string {
  if (!value) return '—'
  if (value.includes('T')) {
    return formatTime(toPakistanTime24(value))
  }
  if (/^\d{2}:\d{2}$/.test(value)) {
    return formatTime(value)
  }
  return value
}
