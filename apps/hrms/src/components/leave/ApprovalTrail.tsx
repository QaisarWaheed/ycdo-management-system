import { format } from 'date-fns'
import { Check, Circle, X } from 'lucide-react'
import type { LeaveApproval, LeaveRecord } from '@/types'
import { cn } from '@/lib/utils'

function stepIcon(action?: LeaveApproval['action']) {
  if (action === 'APPROVED') {
    return <Check className="h-4 w-4 text-green-600" />
  }
  if (action === 'REJECTED') {
    return <X className="h-4 w-4 text-red-600" />
  }
  return <Circle className="h-4 w-4 text-text-secondary" />
}

function findApproval(approvals: LeaveApproval[] | undefined, stage: string) {
  return approvals?.find((a) => a.stage === stage)
}

export function ApprovalTrail({ leave }: { leave: LeaveRecord }) {
  const approvals = leave.approvals ?? []

  const steps = [
    {
      title: 'Branch Manager',
      approval: findApproval(approvals, 'BRANCH_MANAGER'),
    },
    {
      title: 'Department Incharge',
      approval: findApproval(approvals, 'DEPARTMENT_INCHARGE'),
    },
    {
      title: 'Reliever Assignment',
      reliever: leave.relieverRequest?.reliever,
      status: leave.relieverRequest?.status,
    },
    {
      title: 'HR Operations',
      approval: findApproval(approvals, 'HR_OPERATIONS'),
    },
  ]

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4 text-sm">
      <p className="font-semibold">Approval Trail</p>
      {steps.map((step) => (
        <div key={step.title} className="flex items-start gap-3">
          <div className="mt-0.5">
            {'approval' in step && step.approval
              ? stepIcon(step.approval.action)
              : 'reliever' in step && step.reliever
                ? stepIcon('APPROVED')
                : stepIcon()}
          </div>
          <div>
            <p className="font-medium">{step.title}</p>
            {'approval' in step && step.approval ? (
              <p
                className={cn(
                  'text-xs',
                  step.approval.action === 'APPROVED'
                    ? 'text-green-700'
                    : 'text-red-700',
                )}
              >
                {step.approval.action === 'APPROVED' ? 'Approved' : 'Rejected'}{' '}
                by {step.approval.actionByUser?.email ?? 'User'} on{' '}
                {format(new Date(step.approval.actionAt), 'dd/MM/yyyy HH:mm')}
                {step.approval.notes ? ` — ${step.approval.notes}` : ''}
              </p>
            ) : 'reliever' in step && step.reliever ? (
              <p className="text-xs text-green-700">
                {step.reliever.firstName} {step.reliever.lastName} (
                {step.reliever.employeeCode}) — {step.status}
              </p>
            ) : (
              <p className="text-xs text-text-secondary">Pending</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
