import {
  APPROVER_OPTIONS,
  type EmployeeApproverTarget,
} from '@/api/endpoints/employeeOnboarding'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/hooks/useAuth'

const EXECUTIVE_ROLES = ['PRESIDENT', 'FOUNDER', 'CHAIRMAN', 'SUPER_ADMIN']

/** Executives apply pay increases directly; everyone else sends them for approval. */
export function useNeedsPayApproval() {
  const { hasRole } = useAuth()
  return !hasRole(EXECUTIVE_ROLES)
}

/** "Send for approval to" picker shown on pay-increase forms for non-executives. */
export function ApproverSelect({
  value,
  onChange,
  id = 'pay-approver',
}: {
  value?: EmployeeApproverTarget
  onChange: (value: EmployeeApproverTarget) => void
  id?: string
}) {
  return (
    <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3">
      <Label htmlFor={id}>Send for approval to</Label>
      <Select value={value ?? ''} onValueChange={(v) => onChange(v as EmployeeApproverTarget)}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose President, Founder or Chairman Admin" />
        </SelectTrigger>
        <SelectContent>
          {APPROVER_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-amber-900">
        Pay increases take effect only after the executive approves.
      </p>
    </div>
  )
}
