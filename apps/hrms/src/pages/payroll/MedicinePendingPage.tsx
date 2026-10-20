import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import api from '@/api/axios'
import { EmployeeSearchSelect } from '@/components/common/EmployeeSearchSelect'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

interface MedicinePendingEntry {
  id: string
  employeeId: string
  tokenNo: string
  amount: number
  pendingDate: string
  note: string | null
  createdAt: string
  employee: { fullName: string; employeeCode: string; currentBranch: { name: string } | null }
}

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errorText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}
const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`
const today = () => new Date().toISOString().slice(0, 10)
const thisMonth = () => today().slice(0, 7)

/** Finance's daily Medicine Pending log; each entry comes off that month's salary. */
export function MedicinePendingPage() {
  const queryClient = useQueryClient()
  const canWrite = useAuth().hasRole(['PAYROLL_OFFICER', 'SUPER_ADMIN'])
  const [month, setMonth] = useState(thisMonth())
  const [employeeId, setEmployeeId] = useState('')
  const [tokenNo, setTokenNo] = useState('')
  const [amount, setAmount] = useState('')
  const [pendingDate, setPendingDate] = useState(today())
  const [search, setSearch] = useState('')

  const [y, m] = month.split('-').map(Number)
  const from = `${month}-01`
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['medicine-pending', month],
    queryFn: () => api.get<unknown, MedicinePendingEntry[]>('/medicine-pending', { params: { from, to } }),
  })
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(
      (r) =>
        !q ||
        r.employee.fullName.toLowerCase().includes(q) ||
        r.employee.employeeCode.toLowerCase().includes(q) ||
        r.tokenNo.toLowerCase().includes(q),
    )
  }, [rows, search])
  const total = shown.reduce((s, r) => s + r.amount, 0)

  const add = useMutation({
    mutationFn: () =>
      api.post('/medicine-pending', { employeeId, tokenNo: tokenNo.trim(), amount: Number(amount), pendingDate }),
    onSuccess: () => {
      toast({ title: 'Medicine pending saved and added to the salary deductions' })
      setTokenNo('')
      setAmount('')
      queryClient.invalidateQueries({ queryKey: ['medicine-pending'] })
    },
    onError: (err: ApiError) => toast({ title: 'Could not save', description: errorText(err), variant: 'destructive' }),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/medicine-pending/${id}`),
    onSuccess: () => {
      toast({ title: 'Entry removed and taken off the salary' })
      queryClient.invalidateQueries({ queryKey: ['medicine-pending'] })
    },
    onError: (err: ApiError) => toast({ title: 'Could not remove', description: errorText(err), variant: 'destructive' }),
  })
  const valid = !!employeeId && tokenNo.trim().length > 0 && Number(amount) > 0 && !!pendingDate

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Medicine Pending</h1>
        <p className="text-sm text-text-secondary">
          Daily entries of medicine taken on credit. Each entry is deducted from the salary of the month of its pending
          date and shows on the salary slip.
        </p>
      </div>

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">New entry</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="sm:col-span-2">
              <EmployeeSearchSelect value={employeeId} onChange={(id) => setEmployeeId(id)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mp-token">Token number</Label>
              <Input id="mp-token" value={tokenNo} onChange={(e) => setTokenNo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mp-amount">Amount (PKR)</Label>
              <Input id="mp-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mp-date">Medicine pending date</Label>
              <Input id="mp-date" type="date" value={pendingDate} onChange={(e) => setPendingDate(e.target.value)} />
            </div>
            <div className="sm:col-span-2 lg:col-span-5">
              <Button disabled={!valid || add.isPending} onClick={() => add.mutate()}>
                {add.isPending ? 'Saving...' : 'Save entry'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="mp-month">Month</Label>
          <Input id="mp-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <Input
          className="max-w-xs"
          placeholder="Search name, code or token"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="pb-2 text-sm text-text-secondary">
          {shown.length} entries · total {pkr(total)}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Pending date</TableHead>
                <TableHead>Entry date</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6}>Loading…</TableCell>
                </TableRow>
              ) : shown.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-text-secondary">
                    No entries this month
                  </TableCell>
                </TableRow>
              ) : (
                shown.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link to={`/employees/${r.employeeId}`} className="font-medium text-primary hover:underline">
                        {r.employee.fullName}
                      </Link>
                      <div className="text-xs text-text-secondary">
                        {r.employee.employeeCode}
                        {r.employee.currentBranch ? ` · ${r.employee.currentBranch.name}` : ''}
                      </div>
                    </TableCell>
                    <TableCell>{r.tokenNo}</TableCell>
                    <TableCell>{pkr(r.amount)}</TableCell>
                    <TableCell>{format(new Date(r.pendingDate), 'dd MMM yyyy')}</TableCell>
                    <TableCell className="text-sm">{format(new Date(r.createdAt), 'dd MMM yyyy, h:mm a')}</TableCell>
                    <TableCell className="text-right">
                      {canWrite ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (window.confirm('Remove this entry? It will be taken off the salary deduction.'))
                              remove.mutate(r.id)
                          }}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
