import { Label } from '@/components/ui/label'
import { ROLE_GROUPS, formatRole, isExecutiveRole } from '@/lib/roleLabels'
import { cn } from '@/lib/utils'

type RoleMultiSelectProps = {
  primaryRole: string
  additionalRoles: string[]
  assignableRoles: string[]
  /** Roles allowed as additional (defaults to assignable minus executives). */
  additionalAssignableRoles?: string[]
  onPrimaryChange: (role: string) => void
  onAdditionalChange: (roles: string[]) => void
  disabled?: boolean
}

export function RoleMultiSelect({
  primaryRole,
  additionalRoles,
  assignableRoles,
  additionalAssignableRoles,
  onPrimaryChange,
  onAdditionalChange,
  disabled,
}: RoleMultiSelectProps) {
  const primaryAllowed = new Set(assignableRoles)
  const additionalAllowed = new Set(
    (additionalAssignableRoles ?? assignableRoles).filter(
      (role) => !isExecutiveRole(role),
    ),
  )

  const toggleAdditional = (role: string) => {
    if (role === primaryRole || isExecutiveRole(role)) return
    if (additionalRoles.includes(role)) {
      onAdditionalChange(additionalRoles.filter((value) => value !== role))
    } else {
      onAdditionalChange([...additionalRoles, role])
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Primary role</Label>
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={primaryRole}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value
            onPrimaryChange(next)
            onAdditionalChange(
              additionalRoles.filter(
                (role) => role !== next && !isExecutiveRole(role),
              ),
            )
          }}
        >
          {ROLE_GROUPS.flatMap((group) =>
            group.roles
              .filter((role) => primaryAllowed.has(role) || role === primaryRole)
              .map((role) => (
                <option key={role} value={role}>
                  {formatRole(role)}
                </option>
              )),
          )}
        </select>
      </div>

      <div className="space-y-2">
        <Label>Additional roles</Label>
        <p className="text-xs text-text-secondary">
          President, Chairman Admin, and Founder cannot be additional roles.
          Use hospital management scopes for department/designation access.
        </p>
        <div className="max-h-48 space-y-3 overflow-y-auto rounded-md border border-border p-3">
          {ROLE_GROUPS.map((group) => {
            const roles = group.roles.filter(
              (role) =>
                !isExecutiveRole(role) &&
                (additionalAllowed.has(role) ||
                  additionalRoles.includes(role) ||
                  role === primaryRole),
            )
            if (!roles.length) return null
            return (
              <div key={group.title} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  {group.title}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {roles.map((role) => {
                    const isPrimary = role === primaryRole
                    const checked = isPrimary || additionalRoles.includes(role)
                    return (
                      <label
                        key={role}
                        className={cn(
                          'flex items-center gap-2 rounded-md border border-transparent px-2 py-1 text-sm',
                          isPrimary && 'bg-surface text-text-secondary',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={checked}
                          disabled={disabled || isPrimary}
                          onChange={() => toggleAdditional(role)}
                        />
                        <span>{formatRole(role)}</span>
                        {isPrimary && (
                          <span className="text-xs text-text-secondary">
                            (primary)
                          </span>
                        )}
                      </label>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
