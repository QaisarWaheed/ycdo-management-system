export function formatBranchLabel(
  branch?: { name?: string | null; address?: string | null } | null,
  fallback = '—',
): string {
  if (!branch?.name) return fallback;
  const address = branch.address?.trim();
  return address ? `${branch.name} — ${address}` : branch.name;
}
