export function formatTime(time: string): string {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  const period = h < 12 ? 'AM' : 'PM'
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

export function formatDateTimeTime(value?: string | null): string {
  if (!value) return '—'
  if (value.includes('T')) {
    const d = new Date(value)
    const h = d.getHours()
    const m = d.getMinutes()
    return formatTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }
  if (/^\d{2}:\d{2}$/.test(value)) {
    return formatTime(value)
  }
  return value
}
