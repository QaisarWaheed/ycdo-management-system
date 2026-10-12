import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** '' = monthly allowed-leave rule; otherwise the pay % HR gives these leave days. */
export type LeavePayChoice = '' | '100' | '50' | '0'

export const leavePayPercent = (v: LeavePayChoice) => (v === '' ? undefined : Number(v))

export const LEAVE_PAY_LABELS: Record<string, string> = {
  '100': 'Full pay',
  '50': '50% pay',
  '0': 'Without pay',
}

/**
 * HR chooses how the leave days are paid: the normal monthly quota, full pay,
 * half pay (e.g. medical or marriage leave) or without pay.
 */
export function LeavePaySelect({
  value,
  onChange,
  id = 'leave-pay',
}: {
  value: LeavePayChoice
  onChange: (v: LeavePayChoice) => void
  id?: string
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Pay for these leave days</Label>
      <Select value={value || 'quota'} onValueChange={(v) => onChange(v === 'quota' ? '' : (v as LeavePayChoice))}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="quota">Normal (monthly allowed leaves)</SelectItem>
          <SelectItem value="100">Full pay</SelectItem>
          <SelectItem value="50">50% pay (e.g. medical / marriage)</SelectItem>
          <SelectItem value="0">Without pay</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        50% pays half of the Basic for each leave day; allowances are not cut.
      </p>
    </div>
  )
}
