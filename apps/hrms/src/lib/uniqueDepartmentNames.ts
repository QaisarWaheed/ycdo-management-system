export function normalizeDepartmentKey(name: string) {
  return name.trim().toLowerCase()
}

/** One display name per department spelling (case-insensitive, trimmed). */
export function getUniqueDepartmentNames(names: string[]) {
  const canonicalByKey = new Map<string, string>()
  const variantCounts = new Map<string, Map<string, number>>()

  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue

    const key = normalizeDepartmentKey(name)
    const counts = variantCounts.get(key) ?? new Map<string, number>()
    counts.set(name, (counts.get(name) ?? 0) + 1)
    variantCounts.set(key, counts)

    const current = canonicalByKey.get(key)
    if (!current) {
      canonicalByKey.set(key, name)
      continue
    }

    const currentCount = counts.get(current) ?? 0
    const nextCount = counts.get(name) ?? 0
    if (nextCount > currentCount) {
      canonicalByKey.set(key, name)
    }
  }

  return [...canonicalByKey.values()].sort((a, b) => a.localeCompare(b))
}

export function resolveCanonicalDepartmentName(
  name: string,
  canonicalNames: string[],
) {
  const trimmed = name.trim()
  if (!trimmed) return trimmed

  const key = normalizeDepartmentKey(trimmed)
  return (
    canonicalNames.find((c) => normalizeDepartmentKey(c) === key) ?? trimmed
  )
}

/** All stored spellings that match a canonical department label. */
export function getMatchingDepartmentLabels(
  canonicalName: string,
  allLabels: string[],
) {
  const key = normalizeDepartmentKey(canonicalName)
  const matches = allLabels
    .map((label) => label.trim())
    .filter((label) => label && normalizeDepartmentKey(label) === key)

  return [...new Set(matches.length > 0 ? matches : [canonicalName.trim()])]
}
