/** Split fullName into first/last for forms that still use two fields. */
export function splitFullName(fullName: string): {
  firstName: string
  lastName: string
} {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0]!, lastName: '' }
  return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') }
}

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
