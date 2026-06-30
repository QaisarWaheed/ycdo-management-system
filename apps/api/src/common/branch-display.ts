export const BRANCH_DISPLAY_SELECT = {
  name: true,
  address: true,
} as const;

export function formatBranchLabel(
  branch?: { name?: string | null; address?: string | null } | null,
): string | null {
  if (!branch?.name) return null;
  const address = branch.address?.trim();
  return address ? `${branch.name} — ${address}` : branch.name;
}
