export const BRANCH_SCOPED_ROLES = ['ADMIN_MANAGER'] as const

type ScopedUser = {
  role?: string | null
  branchId?: string | null
} | null | undefined

export function isBranchScopedRole(role?: string | null) {
  return (
    role != null &&
    (BRANCH_SCOPED_ROLES as readonly string[]).includes(role)
  )
}

export function getLockedBranchId(user: ScopedUser) {
  if (!isBranchScopedRole(user?.role) || !user?.branchId) {
    return undefined
  }
  return user.branchId
}
