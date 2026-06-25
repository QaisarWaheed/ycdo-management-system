export function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export function shiftsOverlap(
  requesterStart: string,
  requesterEnd: string,
  relieverStart: string,
  relieverEnd: string,
): boolean {
  let rStart = parseTimeToMinutes(requesterStart)
  let rEnd = parseTimeToMinutes(requesterEnd)
  let vStart = parseTimeToMinutes(relieverStart)
  let vEnd = parseTimeToMinutes(relieverEnd)

  if (rEnd <= rStart) rEnd += 24 * 60
  if (vEnd <= vStart) vEnd += 24 * 60

  return vStart < rEnd && vEnd > rStart
}

export function hasShiftConflict(
  requesterShift?: { startTime: string; endTime: string } | null,
  relieverShift?: { startTime: string; endTime: string } | null,
): boolean {
  if (!requesterShift || !relieverShift) return false
  return shiftsOverlap(
    requesterShift.startTime,
    requesterShift.endTime,
    relieverShift.startTime,
    relieverShift.endTime,
  )
}
