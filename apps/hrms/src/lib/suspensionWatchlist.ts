export type WatchReason = 'LATE_NEAR' | 'LATE_DUE' | 'UA_NEAR' | 'UA_DUE'

export type WatchEntry = {
  employeeId: string
  fullName: string
  employeeCode: string | null
  biometricId: string | null
  phone: string | null
  branchId: string | null
  branchName: string | null
  lateDays: number
  uninformedAbsentDays: number
  reasons: WatchReason[]
}

export function classifySuspensionWatchBucket(
  lateDays: number,
  uninformedAbsentDays: number,
): 'near' | 'due' | null {
  if (lateDays >= 9 || uninformedAbsentDays >= 3) return 'due'
  if ((lateDays >= 6 && lateDays <= 8) || uninformedAbsentDays === 2) {
    return 'near'
  }
  return null
}

function isWatchEntry(value: unknown): value is WatchEntry {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<WatchEntry>
  return typeof row.employeeId === 'string' && typeof row.fullName === 'string'
}

function collectEntries(raw: unknown): WatchEntry[] {
  if (Array.isArray(raw)) {
    return raw.filter(isWatchEntry)
  }
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>
  const nested =
    obj.near || obj.due
      ? obj
      : obj.data && typeof obj.data === 'object'
        ? (obj.data as Record<string, unknown>)
        : obj
  return [
    ...(Array.isArray(nested.near) ? nested.near.filter(isWatchEntry) : []),
    ...(Array.isArray(nested.due) ? nested.due.filter(isWatchEntry) : []),
  ]
}

/** Each employee appears in at most one tab; others are dropped. */
export function partitionSuspensionWatchlist(raw: unknown): {
  near: WatchEntry[]
  due: WatchEntry[]
} {
  const byId = new Map<string, WatchEntry>()
  for (const row of collectEntries(raw)) {
    const bucket = classifySuspensionWatchBucket(
      Number(row.lateDays) || 0,
      Number(row.uninformedAbsentDays) || 0,
    )
    if (!bucket) continue
    byId.set(row.employeeId, row)
  }

  const near: WatchEntry[] = []
  const due: WatchEntry[] = []
  for (const row of byId.values()) {
    const bucket = classifySuspensionWatchBucket(
      Number(row.lateDays) || 0,
      Number(row.uninformedAbsentDays) || 0,
    )
    if (bucket === 'due') due.push(row)
    else if (bucket === 'near') near.push(row)
  }
  return { near, due }
}
