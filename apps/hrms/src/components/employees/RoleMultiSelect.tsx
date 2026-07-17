import { Label } from '@/components/ui/label'
import { ROLE_GROUPS, formatRole } from '@/lib/roleLabels'

type RoleMultiSelectProps = {
  primaryRole: string
  assignableRoles: string[]
  onPrimaryChange: (role: string) => void
  disabled?: boolean
}

export function RoleMultiSelect({
  primaryRole,
  assignableRoles,
  onPrimaryChange,
  disabled,
}: RoleMultiSelectProps) {
  const primaryAllowed = new Set(assignableRoles)

  return (
    <div className="space-y-2">
      <Label>Primary role</Label>
      <p className="text-xs text-text-secondary">
        Primary role controls the default dashboard view. Use hospital
        management scopes for department/designation access.
      </p>
      <select
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        value={primaryRole}
        disabled={disabled}
        onChange={(event) => onPrimaryChange(event.target.value)}
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
  )
}
