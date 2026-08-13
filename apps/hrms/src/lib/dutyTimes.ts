/** Half-hour increments, 12:00 AM through 11:30 PM. */
export const dutyTimeOptions = Array.from({ length: 48 }, (_, i) => {
  const h24 = Math.floor(i / 2)
  const m = i % 2 === 0 ? '00' : '30'
  const suffix = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return {
    label: `${String(h12).padStart(2, '0')}:${m} ${suffix}`,
    value: `${String(h24).padStart(2, '0')}:${m}`,
  }
})

/** Parses "HH:mm" (24h) OR "hh:mm AM/PM". */
export function parseDutyTimeToMinutes(value: string): number {
  const v = value.trim()
  const ampm = v.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (ampm) {
    let h = parseInt(ampm[1], 10) % 12
    if (/pm/i.test(ampm[3])) h += 12
    return h * 60 + parseInt(ampm[2], 10)
  }
  const h24 = v.match(/^(\d{1,2}):(\d{2})$/)
  if (h24) {
    const h = parseInt(h24[1], 10)
    const m = parseInt(h24[2], 10)
    if (h > 23 || m > 59) throw new Error(`Invalid duty time: "${value}"`)
    return h * 60 + m
  }
  throw new Error(`Unparseable duty time: "${value}"`)
}

/** Canonical display format: "08:00 AM" */
export function formatDuty12h(value: string): string {
  const mins = parseDutyTimeToMinutes(value)
  const h24 = Math.floor(mins / 60)
  const m = mins % 60
  const suffix = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`
}

export function formatDutyDisplay(
  start?: string | null,
  end?: string | null,
): string {
  if (!start || !end) return 'Not assigned'
  try {
    return `${formatDuty12h(start)} - ${formatDuty12h(end)}`
  } catch {
    return `${start} - ${end}`
  }
}

/**
 * Employee.dutyStartTime/dutyEndTime is the single source of truth.
 * Shift name may still be shown; shift clock times are ignored.
 */
export function formatEmployeeShiftDisplay(employee: {
  dutyStartTime?: string | null
  dutyEndTime?: string | null
  shift?: { startTime?: string; endTime?: string; name?: string } | null
}): string {
  const start = employee.dutyStartTime
  const end = employee.dutyEndTime
  const hours = formatDutyDisplay(start, end)
  if (hours === 'Not assigned') {
    return employee.shift?.name ?? 'Not assigned'
  }
  return employee.shift?.name ? `${employee.shift.name} · ${hours}` : hours
}

export function timeToMinutes(time: string): number {
  return parseDutyTimeToMinutes(time)
}

export function getStartTimeOptionsForShift(shift: string) {
  const all = dutyTimeOptions
  switch (shift) {
    case 'Morning':
      return all.filter((t) => {
        const h = parseInt(t.value.split(':')[0], 10)
        return h >= 0 && h < 12
      })
    case 'Evening':
      return all.filter((t) => {
        const h = parseInt(t.value.split(':')[0], 10)
        return h >= 12 && h < 18
      })
    case 'Night':
      return all.filter((t) => {
        const h = parseInt(t.value.split(':')[0], 10)
        return h >= 18 && h <= 23
      })
    case '24 Hours':
      return [{ label: '12:00 AM', value: '00:00' }]
    default:
      return all
  }
}

export function calculateDutyEndTime(
  startTime: string,
  totalHours: number,
): string {
  const [h, m] = startTime.split(':').map(Number)
  const endHour = (h + totalHours) % 24
  return `${String(endHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
