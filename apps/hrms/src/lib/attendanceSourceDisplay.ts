type PunchSourceLog = {
  checkIn?: string | null
  checkOut?: string | null
  source?: string | null
  checkInSource?: string | null
  checkOutSource?: string | null
}

export function displayCheckInSource(log: PunchSourceLog): string {
  if (log.checkIn == null || log.checkIn === '') return '—'
  return log.checkInSource ?? log.source ?? '—'
}

export function displayCheckOutSource(log: PunchSourceLog): string {
  if (log.checkOut == null || log.checkOut === '') return '—'
  return log.checkOutSource ?? log.source ?? '—'
}

export function formatPunchSourcesLabel(log: PunchSourceLog): string {
  return `In: ${displayCheckInSource(log)} · Out: ${displayCheckOutSource(log)}`
}
