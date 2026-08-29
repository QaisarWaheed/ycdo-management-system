import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { FileCheck } from 'lucide-react'
import { lettersApi } from '@/api/endpoints/letters'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { formatBranchTableLabel } from '@/lib/formatBranchLabel'
import { letterReference } from '@/lib/letterFieldConfig'
import type { Letter } from '@/types'

export function PendingAppointmentApprovalsCard() {
  const { hasRole } = useAuth()
  const canReview = hasRole([
    'SUPER_ADMIN',
    'PRESIDENT',
    'FOUNDER',
    'CHAIRMAN',
  ])
  const queryClient = useQueryClient()
  const [busyId, setBusyId] = useState<string | null>(null)

  const { data: pending = [] } = useQuery({
    queryKey: ['letters', 'appointment-approvals', 'pending'],
    queryFn: () => lettersApi.getPendingAppointmentApprovals(),
    enabled: canReview,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: ['letters', 'appointment-approvals'],
    })
    queryClient.invalidateQueries({ queryKey: ['letters'] })
  }

  const approveMutation = useMutation({
    mutationFn: (id: string) => lettersApi.approve(id),
    onSuccess: () => {
      toast({
        title: 'Appointment letter approved',
        description: 'HR still has to Send. The employee is not activated yet.',
      })
      invalidate()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Approve failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
    onSettled: () => setBusyId(null),
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => lettersApi.reject(id),
    onSuccess: () => {
      toast({
        title: 'Returned for changes',
        description: 'HR can edit the draft and resubmit.',
      })
      invalidate()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Return failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
    onSettled: () => setBusyId(null),
  })

  const printDraft = async (letter: Letter) => {
    try {
      const { downloadLetterPdf } = await import('@/lib/downloadLetterPdf')
      await downloadLetterPdf(letter.id, `${letterReference(letter)}.pdf`)
    } catch (err) {
      toast({
        title: 'Could not print draft',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      })
    }
  }

  if (!canReview) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileCheck className="h-5 w-5 text-primary" />
          Pending Appointment Letters
          <Badge className="ml-2">{pending.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {pending.length === 0 ? (
          <p className="py-4 text-center text-sm text-text-secondary">
            No appointment letters waiting for approval
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((letter) => {
                const branch = formatBranchTableLabel(
                  letter.employee?.currentBranch,
                  '',
                )
                return (
                  <TableRow key={letter.id}>
                    <TableCell>
                      <EmployeeNameLink
                        employee={{
                          id: letter.employee?.id ?? letter.employeeId,
                          fullName: letter.employee?.fullName,
                          employeeCode: letter.employee?.employeeCode,
                        }}
                      />
                      <p className="text-xs text-text-secondary">
                        {letter.employee?.employeeCode}
                        {branch ? ` · ${branch}` : ''}
                      </p>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {letter.letterNo ?? letterReference(letter)}
                    </TableCell>
                    <TableCell>
                      {format(new Date(letter.generatedAt), 'dd/MM/yyyy')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => printDraft(letter)}
                        >
                          Print Draft
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === letter.id}
                          onClick={() => {
                            setBusyId(letter.id)
                            rejectMutation.mutate(letter.id)
                          }}
                        >
                          Return
                        </Button>
                        <Button
                          size="sm"
                          disabled={busyId === letter.id}
                          onClick={() => {
                            setBusyId(letter.id)
                            approveMutation.mutate(letter.id)
                          }}
                        >
                          Approve
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
