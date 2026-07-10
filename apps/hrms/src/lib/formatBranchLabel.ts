export type BranchLabelSource = {
  name?: string | null
  address?: string | null
  abbreviation?: string | null
}

export function formatBranchLabel(
  branch?: BranchLabelSource | null,
  fallback = '—',
): string {
  if (!branch?.name) return fallback
  const address = branch.address?.trim()
  return address ? `${branch.name} — ${address}` : branch.name
}

/** Compact label for data tables — uses abbreviation when set. */
export function formatBranchTableLabel(
  branch?: BranchLabelSource | null,
  fallback = '—',
): string {
  const abbr = branch?.abbreviation?.trim()
  if (abbr) return abbr
  if (!branch?.name) return fallback
  return branch.name
}
