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

/**
 * Compact label for data tables. Uses the branch name — the same source the
 * employee profile shows — so tables and profiles never disagree. The
 * hand-entered abbreviation is only a fallback for unnamed branches.
 */
export function formatBranchTableLabel(
  branch?: BranchLabelSource | null,
  fallback = '—',
): string {
  const name = branch?.name?.trim()
  if (name) return name
  const abbr = branch?.abbreviation?.trim()
  if (abbr) return abbr
  return fallback
}
