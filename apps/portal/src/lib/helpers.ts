import type { Letter } from '@/types'

export function letterReference(letter: Letter): string {
  if (!letter.fileUrl) return letter.id.slice(0, 8).toUpperCase()
  const name = letter.fileUrl.split('/').pop()?.replace(/\.pdf$/i, '')
  return name?.replace(/_/g, '/') ?? letter.id.slice(0, 8)
}

export function letterTypeBadgeClass(type: string): string {
  const disciplinary = ['WARNING', 'DISCIPLINARY', 'SHOW_CAUSE', 'FINE', 'SUSPENSION', 'TERMINATION']
  const positive = ['APPOINTMENT', 'APPRECIATION', 'REINSTATEMENT', 'REJOINING', 'SALARY_INCREMENT', 'EXPERIENCE']
  if (disciplinary.includes(type)) return 'bg-red-100 text-red-800 border-red-200'
  if (positive.includes(type)) return 'bg-green-100 text-green-800 border-green-200'
  return 'bg-blue-100 text-blue-800 border-blue-200'
}

export function formatPKR(amount: number | string) {
  return `PKR ${Number(amount).toLocaleString('en-PK')}`
}

export function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h} hrs ${m} mins`
}

export function calcHoursWorked(checkIn?: string | null, checkOut?: string | null): string {
  if (!checkIn || !checkOut) return '—'
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime()
  const mins = Math.round(ms / 60000)
  return formatDuration(mins)
}
