import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Plus, Trash2 } from 'lucide-react'
import {
  additionalWorkingDaysApi,
  type AdditionalWorkingDay,
} from '@/api/endpoints/additionalWorkingDays'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'

type Props = {
  employeeId: string
  dailyDutyHours?: number | null
  canEdit?: boolean
}

function isRelieverRow(row: AdditionalWorkingDay) {
  return !!row.relieverSessionId
}

export function AdditionalWorkingDaysTab({
  employeeId,
  dailyDutyHours,
  canEdit = false,
}: Props) {
  const queryClient = useQueryClient()
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')

  const { data = [], isLoading } = useQuery({
    queryKey: ['additional-working-days', employeeId],
    queryFn: () => additionalWorkingDaysApi.getByEmployee(employeeId),
    enabled: !!employeeId,
  })

  const hoursPerDay = dailyDutyHours && dailyDutyHours > 0 ? dailyDutyHours : 8

  const payableManualDays = data.filter((row) => !isRelieverRow(row)).length
  const relieverDays = data.filter((row) => isRelieverRow(row)).length
  const payableDays = payableManualDays + relieverDays
  const payableHours = useMemo(
    () => payableDays * hoursPerDay,
    [payableDays, hoursPerDay],
  )

  const createMutation = useMutation({
    mutationFn: () =>
      additionalWorkingDaysApi.create({
        employeeId,
        date,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Additional working day added' })
      setDate('')
      setNote('')
      queryClient.invalidateQueries({
        queryKey: ['additional-working-days', employeeId],
      })
      queryClient.invalidateQueries({ queryKey: ['payroll-history', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to add day',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => additionalWorkingDaysApi.delete(id),
    onSuccess: () => {
      toast({ title: 'Additional working day removed' })
      queryClient.invalidateQueries({
        queryKey: ['additional-working-days', employeeId],
      })
      queryClient.invalidateQueries({ queryKey: ['payroll-history', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to delete',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        HR can add extra duty days here. They are already approved — no second
        approval. Each day pays {hoursPerDay} duty hours on salary Extra Day.
        Completed reliever duty is listed automatically and paid the same way
        (one extra full duty day).
      </p>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Add day</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="awd-date">Date</Label>
              <Input
                id="awd-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-[180px]"
              />
            </div>
            <div className="min-w-[220px] flex-1 space-y-1">
              <Label htmlFor="awd-note">Note (optional)</Label>
              <Input
                id="awd-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Double duty covering …"
              />
            </div>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={!date || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Payroll</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Added by</TableHead>
                  {canEdit && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={canEdit ? 5 : 4}
                      className="text-text-secondary"
                    >
                      No additional working days recorded
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {data.map((row: AdditionalWorkingDay) => {
                      const fromReliever = isRelieverRow(row)
                      return (
                        <TableRow key={row.id}>
                          <TableCell>
                            {format(new Date(row.date), 'dd/MM/yyyy')}
                          </TableCell>
                          <TableCell>
                            {fromReliever ? (
                              <span className="text-sm">
                                {hoursPerDay}h extra duty (reliever)
                              </span>
                            ) : (
                              `${hoursPerDay}h extra duty`
                            )}
                          </TableCell>
                          <TableCell className="max-w-[280px]">
                            <div className="flex flex-wrap items-center gap-2">
                              {fromReliever && (
                                <Badge variant="secondary">From reliever</Badge>
                              )}
                              <span className="truncate">
                                {row.note ?? '—'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-text-secondary">
                            {row.addedBy?.email ?? row.addedById.slice(0, 8)}
                          </TableCell>
                          {canEdit && (
                            <TableCell>
                              {!fromReliever && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={deleteMutation.isPending}
                                  onClick={() => deleteMutation.mutate(row.id)}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                    <TableRow className="bg-surface font-semibold">
                      <TableCell>Payroll total (extra duty)</TableCell>
                      <TableCell>
                        {payableDays} day(s) · {payableHours}h
                      </TableCell>
                      <TableCell colSpan={canEdit ? 3 : 2} className="font-normal text-text-secondary">
                        Already approved. Paid on Extra Day when payroll is
                        pending.
                      </TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
