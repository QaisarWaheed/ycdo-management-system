import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Check, UserCheck, X } from 'lucide-react'
import {
  employeeOnboardingApi,
  type EmployeeOnboardingApproval,
} from '@/api/endpoints/employeeOnboarding'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/useAuth'
import { portalRoleLabel } from '@/lib/portalRoles'
import { toast } from '@/hooks/use-toast'
import { getApiErrorMessage } from '@/lib/apiErrorMessage'

const MIN_REASON_LENGTH = 5

function formatBranch(
  branch?: { name: string; abbreviation?: string | null } | null,
) {
  if (!branch) return '—'
  return branch.abbreviation
    ? `${branch.name} (${branch.abbreviation})`
    : branch.name
}

export function ExecutivePortalDashboard() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<EmployeeOnboardingApproval | null>(
    null,
  )
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ['employee-onboarding', 'pending'],
    queryFn: () => employeeOnboardingApi.getPending(),
  })

  const closeSheet = () => {
    setSelected(null)
    setRejecting(false)
    setRejectReason('')
  }

  const approveMutation = useMutation({
    mutationFn: (id: string) => employeeOnboardingApi.approve(id),
    onSuccess: () => {
      toast({ title: 'Employee approved and activated' })
      queryClient.invalidateQueries({ queryKey: ['employee-onboarding'] })
      closeSheet()
    },
    onError: (err) =>
      toast({
        title: 'Approval failed',
        description: getApiErrorMessage(err, 'Error'),
        variant: 'destructive',
      }),
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      employeeOnboardingApi.reject(id, reason),
    onSuccess: () => {
      toast({ title: 'Employee request rejected' })
      queryClient.invalidateQueries({ queryKey: ['employee-onboarding'] })
      closeSheet()
    },
    onError: (err) =>
      toast({
        title: 'Rejection failed',
        description: getApiErrorMessage(err, 'Error'),
        variant: 'destructive',
      }),
  })

  const busy = approveMutation.isPending || rejectMutation.isPending
  const reasonTooShort = rejectReason.trim().length < MIN_REASON_LENGTH
  const roleLabel = portalRoleLabel(user?.role)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-text-primary sm:text-2xl">
          {roleLabel} Dashboard
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Review new employee joining requests on mobile or desktop
        </p>
      </div>

      <Card className="border-primary/30 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            <UserCheck className="h-5 w-5 text-primary" />
            Pending Approvals
            <Badge className="ml-1">{pending.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-text-secondary">
              Loading…
            </p>
          ) : pending.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-secondary">
              No pending joining requests
            </p>
          ) : (
            pending.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelected(item)
                  setRejecting(false)
                  setRejectReason('')
                }}
                className="flex w-full flex-col gap-1 rounded-xl border border-border bg-white p-4 text-left transition-colors hover:border-primary/40 hover:bg-surface/60 active:bg-surface"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-text-primary">
                      {item.employee?.fullName ?? 'Employee'}
                    </p>
                    <p className="font-mono text-xs text-text-secondary">
                      {item.employee?.employeeCode ?? '—'}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-text-secondary">
                    {format(new Date(item.createdAt), 'dd MMM')}
                  </span>
                </div>
                <p className="text-sm text-text-secondary">
                  {item.employee?.currentDesignation ?? '—'}
                  {' · '}
                  {formatBranch(item.employee?.currentBranch)}
                </p>
                <p className="text-xs font-medium text-primary">Tap to review →</p>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) closeSheet()
        }}
      >
        <SheetContent
          side="bottom"
          className="flex max-h-[92dvh] flex-col rounded-t-2xl p-0"
        >
          {selected && (
            <>
              <SheetHeader className="border-b border-border px-5 py-4 text-left">
                <SheetTitle className="text-lg">
                  {selected.employee?.fullName ?? 'Review employee'}
                </SheetTitle>
                <p className="text-sm text-text-secondary">
                  {selected.employee?.employeeCode}
                  {selected.employee?.currentDesignation
                    ? ` · ${selected.employee.currentDesignation}`
                    : ''}
                </p>
              </SheetHeader>

              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-text-secondary">Branch</dt>
                    <dd className="font-medium">
                      {formatBranch(selected.employee?.currentBranch)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-secondary">Department</dt>
                    <dd className="font-medium">
                      {selected.employee?.currentDepartment?.name ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-secondary">Joining date</dt>
                    <dd className="font-medium">
                      {selected.employee?.joiningDate
                        ? format(
                            new Date(selected.employee.joiningDate),
                            'dd MMM yyyy',
                          )
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-secondary">Submitted</dt>
                    <dd className="font-medium">
                      {format(new Date(selected.createdAt), 'dd MMM yyyy HH:mm')}
                    </dd>
                  </div>
                </dl>

                {selected.physicalFormUrl && (
                  <a
                    href={selected.physicalFormUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex text-sm font-medium text-primary underline"
                  >
                    Open physical form
                  </a>
                )}

                {rejecting && (
                  <div className="space-y-2">
                    <Label htmlFor="reject-reason">Rejection reason</Label>
                    <Textarea
                      id="reject-reason"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Required — at least 5 characters"
                      className="min-h-[100px] text-base"
                    />
                  </div>
                )}
              </div>

              <SheetFooter className="gap-2 border-t border-border px-5 py-4 sm:flex-col">
                {!rejecting ? (
                  <>
                    <Button
                      className="h-12 w-full bg-primary text-base"
                      disabled={busy}
                      onClick={() => approveMutation.mutate(selected.id)}
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      className="h-12 w-full border-red-300 text-base text-red-700"
                      disabled={busy}
                      onClick={() => setRejecting(true)}
                    >
                      <X className="mr-2 h-4 w-4" />
                      Reject
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="destructive"
                      className="h-12 w-full text-base"
                      disabled={busy || reasonTooShort}
                      onClick={() =>
                        rejectMutation.mutate({
                          id: selected.id,
                          reason: rejectReason.trim(),
                        })
                      }
                    >
                      Confirm rejection
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-11 w-full"
                      disabled={busy}
                      onClick={() => {
                        setRejecting(false)
                        setRejectReason('')
                      }}
                    >
                      Back
                    </Button>
                  </>
                )}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
