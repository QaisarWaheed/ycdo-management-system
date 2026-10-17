export interface BranchRef {
  id: string;
  name?: string | null;
  address?: string | null;
}

function normalizeAddress(address: string | null | undefined): string {
  return (address ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Same branch, or two branches at the same address (they share machines). */
export function isSameBranchSite(
  a: BranchRef | null | undefined,
  b: BranchRef | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.id === b.id) return true;
  const addr = normalizeAddress(a.address);
  return addr !== '' && addr === normalizeAddress(b.address);
}

export function isHeadOfficeBranch(branch: BranchRef | null | undefined) {
  return !!branch?.name?.toLowerCase().includes('head office');
}

/**
 * A punch is accepted only from a device at the employee's own branch (or a
 * branch at the same address). Head Office and 24-hour staff may punch on any
 * device; relievers and mutual-swap covers may punch at the branch they cover.
 * Returns the reject reason, or null when allowed.
 */
export function branchLockRejectReason(opts: {
  employeeBranch: BranchRef | null;
  deviceBranch: BranchRef;
  twentyFourHour: boolean;
  /** Branches the employee covers today (reliever duty, mutual swap). */
  dutyBranches?: BranchRef[];
}): string | null {
  const { employeeBranch, deviceBranch } = opts;
  if (opts.twentyFourHour || isHeadOfficeBranch(employeeBranch)) return null;
  if (isSameBranchSite(employeeBranch, deviceBranch)) return null;
  if (
    (opts.dutyBranches ?? []).some((b) => isSameBranchSite(b, deviceBranch))
  ) {
    return null;
  }
  return `Punch from another branch device: ${deviceBranch.name ?? deviceBranch.id} (employee branch ${employeeBranch?.name ?? 'none'})`;
}
