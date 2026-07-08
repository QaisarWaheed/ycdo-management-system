export function getEmployeeDisplayName(
  employee:
    | { fullName?: string | null; firstName?: string; lastName?: string }
    | null
    | undefined,
  fallback = '—',
): string {
  if (!employee) return fallback
  if (employee.fullName?.trim()) return employee.fullName.trim()
  const legacy = `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim()
  return legacy || fallback
}

/** Initials for avatars from fullName or legacy first/last. */
export function getEmployeeInitials(
  employee:
    | { fullName?: string | null; firstName?: string; lastName?: string }
    | null
    | undefined,
): string {
  if (!employee) return '?'
  if (employee.fullName?.trim()) {
    const parts = employee.fullName.trim().split(/\s+/)
    if (parts.length >= 2) {
      return `${parts[0]!.charAt(0)}${parts[parts.length - 1]!.charAt(0)}`.toUpperCase()
    }
    return parts[0]!.charAt(0).toUpperCase()
  }
  const first = employee.firstName?.charAt(0) ?? ''
  const last = employee.lastName?.charAt(0) ?? ''
  return `${first}${last}`.toUpperCase() || '?'
}
