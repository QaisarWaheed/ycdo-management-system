import { Badge } from '@/components/ui/badge'
import type { LeaveApprovalStage, LeaveStatus } from '@/types'

export function StageBadge({
  status,
  currentStage,
}: {
  status: LeaveStatus
  currentStage?: LeaveApprovalStage | null
}) {
  if (status === 'APPROVED') {
    return (
      <Badge className="border-green-200 bg-green-100 text-green-800">
        Approved
      </Badge>
    )
  }
  if (status === 'REJECTED') {
    return (
      <Badge className="border-red-200 bg-red-100 text-red-800">Rejected</Badge>
    )
  }
  if (status === 'CANCELLED') {
    return (
      <Badge className="border-gray-200 bg-gray-100 text-gray-700">
        Cancelled
      </Badge>
    )
  }

  const stage = currentStage ?? 'BRANCH_MANAGER'

  const labels: Record<LeaveApprovalStage, string> = {
    BRANCH_MANAGER: 'Awaiting Branch Manager',
    DEPARTMENT_INCHARGE: 'Awaiting Dept Incharge',
    HR_OPERATIONS: 'Awaiting HR Operations',
  }

  const styles: Record<LeaveApprovalStage, string> = {
    BRANCH_MANAGER: 'border-blue-200 bg-blue-100 text-blue-800',
    DEPARTMENT_INCHARGE: 'border-purple-200 bg-purple-100 text-purple-800',
    HR_OPERATIONS: 'border-orange-200 bg-orange-100 text-orange-800',
  }

  if (
    status === 'RELIEVER_PENDING' ||
    status === 'RELIEVER_CONFIRMED' ||
    status === 'HR_PENDING'
  ) {
    return (
      <Badge className="border-orange-200 bg-orange-100 text-orange-800">
        {status === 'RELIEVER_PENDING'
          ? 'Awaiting Reliever'
          : 'Awaiting HR Operations'}
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className={styles[stage]}>
      {labels[stage]}
    </Badge>
  )
}
