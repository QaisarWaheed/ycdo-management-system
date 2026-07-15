export const dutyTimeOptions = [
  { label: '12:00 AM', value: '00:00' },
  { label: '01:00 AM', value: '01:00' },
  { label: '02:00 AM', value: '02:00' },
  { label: '03:00 AM', value: '03:00' },
  { label: '04:00 AM', value: '04:00' },
  { label: '05:00 AM', value: '05:00' },
  { label: '06:00 AM', value: '06:00' },
  { label: '07:00 AM', value: '07:00' },
  { label: '08:00 AM', value: '08:00' },
  { label: '09:00 AM', value: '09:00' },
  { label: '10:00 AM', value: '10:00' },
  { label: '11:00 AM', value: '11:00' },
  { label: '12:00 PM', value: '12:00' },
  { label: '01:00 PM', value: '13:00' },
  { label: '02:00 PM', value: '14:00' },
  { label: '03:00 PM', value: '15:00' },
  { label: '04:00 PM', value: '16:00' },
  { label: '05:00 PM', value: '17:00' },
  { label: '06:00 PM', value: '18:00' },
  { label: '07:00 PM', value: '19:00' },
  { label: '08:00 PM', value: '20:00' },
  { label: '09:00 PM', value: '21:00' },
  { label: '10:00 PM', value: '22:00' },
  { label: '11:00 PM', value: '23:00' },
]

import { to12Hour } from '@/lib/timeFormat'

export function formatDutyDisplay(
  start?: string | null,
  end?: string | null,
): string {
  if (!start || !end) return 'Not assigned'
  const startNorm = start.trim().substring(0, 5)
  const endNorm = end.trim().substring(0, 5)
  const startLabel =
    dutyTimeOptions.find((o) => o.value === startNorm)?.label ?? to12Hour(startNorm)
  const endLabel =
    dutyTimeOptions.find((o) => o.value === endNorm)?.label ?? to12Hour(endNorm)
  return `${startLabel} - ${endLabel}`
}

/** Prefer shift model times; fall back to employee duty fields. */
export function formatEmployeeShiftDisplay(employee: {
  dutyStartTime?: string | null
  dutyEndTime?: string | null
  shift?: { startTime?: string; endTime?: string; name?: string } | null
}): string {
  const start = employee.shift?.startTime ?? employee.dutyStartTime
  const end = employee.shift?.endTime ?? employee.dutyEndTime
  return formatDutyDisplay(start, end)
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
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
