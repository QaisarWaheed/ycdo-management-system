import { Badge } from '@/components/ui/badge'
import { formatRole } from '@/lib/roleLabels'
import { cn } from '@/lib/utils'

export function getEmployeeSystemRoles(employee?: {
  user?: {
    role?: string
    roles?: string[]
    additionalRoles?: string[]
  } | null
} | null): string[] {
  if (!employee?.user) return []
  if (employee.user.roles?.length) return employee.user.roles
  const extras = employee.user.additionalRoles ?? []
  const primary = employee.user.role
  return primary ? Array.from(new Set([primary, ...extras])) : extras
}

export function RoleBadges({
  roles,
  className,
  emptyLabel = '—',
}: {
  roles?: string[] | null
  className?: string
  emptyLabel?: string
}) {
  if (!roles?.length) {
    return <span className="text-text-secondary">{emptyLabel}</span>
  }

  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {roles.map((role) => (
        <Badge key={role} variant="outline" className="text-xs font-medium">
          {formatRole(role)}
        </Badge>
      ))}
    </div>
  )
}

export function ManagerScopeBadges({
  scopes,
  className,
  emptyLabel,
}: {
  scopes?: Array<{ label: string; id?: string }> | null
  className?: string
  emptyLabel?: string
}) {
  if (!scopes?.length) {
    if (!emptyLabel) return null
    return <span className="text-text-secondary">{emptyLabel}</span>
  }

  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {scopes.map((scope) => (
        <Badge
          key={scope.id ?? scope.label}
          variant="secondary"
          className="text-xs font-medium"
        >
          {scope.label}
        </Badge>
      ))}
    </div>
  )
}
