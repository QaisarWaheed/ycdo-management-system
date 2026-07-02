import { formatTime } from '@/lib/timeFormat'

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

export function formatDutyDisplay(
  start?: string | null,
  end?: string | null,
): string {
  if (!start || !end) return 'Not assigned'
  const startLabel =
    dutyTimeOptions.find((o) => o.value === start)?.label ?? formatTime(start)
  const endLabel =
    dutyTimeOptions.find((o) => o.value === end)?.label ?? formatTime(end)
  return `${startLabel} - ${endLabel}`
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function calculateDutyEndTime(
  startTime: string,
  totalHours: number,
): string {
  const [h, m] = startTime.split(':').map(Number)
  const endHour = (h + totalHours) % 24
  return `${String(endHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
