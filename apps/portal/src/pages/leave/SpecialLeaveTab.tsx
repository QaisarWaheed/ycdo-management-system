import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import api from '@/api/axios'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'

type SpecialLeaveType = { id: string; name: string; payPercent: number; maxDays: number | null }
type SpecialLeave = {
  id: string
  startDate: string
  endDate: string
  totalDays: number
  status: string
  specialLeaveType: SpecialLeaveType | null
}

const PAY: Record<number, string> = { 100: 'full pay', 50: '50% pay', 0: 'without pay' }
const STATUS: Record<string, string> = {
  HR_PENDING: 'Waiting for HR Operations',
  CHAIRMAN_PENDING: 'Waiting for Chairman',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}
const day = (d: string) => format(new Date(d), 'dd/MM/yyyy')

/** Phase 2 Req 2: employee applies; HR Operations then Chairman decide. */
export function SpecialLeaveTab() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const empty = { specialLeaveTypeId: '', startDate: '', endDate: '', reason: '' }
  const [form, setForm] = useState(empty)
  const { data: types = [] } = useQuery({
    queryKey: ['special-leave-types'],
    queryFn: () => api.get<unknown, SpecialLeaveType[]>('/special-leave/types'),
  })
  const { data: mine = [] } = useQuery({
    queryKey: ['special-leave-mine'],
    queryFn: () => api.get<unknown, SpecialLeave[]>('/special-leave/mine'),
  })
  const mutation = useMutation({
    mutationFn: () => api.post('/special-leave', { ...form, employeeId: user?.employeeId }),
    onSuccess: () => {
      toast({ title: 'Special leave sent to HR Operations' })
      setForm(empty)
      queryClient.invalidateQueries({ queryKey: ['special-leave-mine'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })
  const ready = form.specialLeaveTypeId && form.startDate && form.endDate && form.reason.trim().length >= 3

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
          <p className="text-sm text-text-secondary sm:col-span-2">
            Maternity, accident, marriage and other special leaves. HR Operations and then the
            Chairman approve. Not counted in your normal leave balance.
          </p>
          <div className="space-y-1 sm:col-span-2">
            <Label>Leave type</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.specialLeaveTypeId}
              onChange={(e) => setForm((f) => ({ ...f, specialLeaveTypeId: e.target.value }))}
            >
              <option value="">Select…</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({PAY[t.payPercent]}
                  {t.maxDays ? `, max ${t.maxDays} days` : ''})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>From</Label>
            <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>To</Label>
            <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Reason</Label>
            <Textarea value={form.reason} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </div>
          <Button
            className="bg-primary hover:bg-primary-dark sm:col-span-2 sm:w-fit"
            disabled={!ready || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Apply
          </Button>
        </CardContent>
      </Card>

      {mine.length > 0 && (
        <Card>
          <CardContent className="divide-y p-0">
            {mine.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                <div>
                  <div className="font-medium">{l.specialLeaveType?.name ?? 'Special leave'}</div>
                  <div className="text-text-secondary">
                    {day(l.startDate)} – {day(l.endDate)} · {l.totalDays} day(s)
                  </div>
                </div>
                <Badge variant="secondary">{STATUS[l.status] ?? l.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
