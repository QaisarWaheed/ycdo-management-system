import { Label } from '@/components/ui/label'
import { ROLE_GROUPS, formatRole } from '@/lib/roleLabels'
import { cn } from '@/lib/utils'

type RoleMultiSelectProps = {
  primaryRole: string
  additionalRoles: string[]
  assignableRoles: string[]
  onPrimaryChange: (role: string) => void
  onAdditionalChange: (roles: string[]) => void
  disabled?: boolean
}

export function RoleMultiSelect({
  primaryRole,
  additionalRoles,
  assignableRoles,
  onPrimaryChange,
  onAdditionalChange,
  disabled,
}: RoleMultiSelectProps) {
  const allowed = new Set(assignableRoles)
  const toggleAdditional = (role: string) => {
    if (role === primaryRole) return
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
              additionalRoles.filter((role) => role !== next),
            )
          }}
        >
          {ROLE_GROUPS.flatMap((group) =>
            group.roles
              .filter((role) => allowed.has(role) || role === primaryRole)
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
        <div className="max-h-48 space-y-3 overflow-y-auto rounded-md border border-border p-3">
          {ROLE_GROUPS.map((group) => {
            const roles = group.roles.filter(
              (role) => allowed.has(role) || additionalRoles.includes(role),
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
