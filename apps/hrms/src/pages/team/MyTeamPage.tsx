import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { additionalWorkingDaysApi } from '@/api/endpoints/additionalWorkingDays'
import { DEDUCTION_TYPE_ID, incentiveManagementApi } from '@/api/endpoints/incentiveManagement'
import { teamApi, type MyTeam, type MyTeamEmployee } from '@/api/endpoints/team'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'
import { resolveFileUrl } from '@/lib/resolveFileUrl'

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errorText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}
const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`
const thisMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const STATUS: Record<string, string> = {
  PENDING: 'waiting',
  ESCALATED: 'with Chairman',
  APPROVED: 'approved',
  AMENDED: 'approved (changed)',
  REJECTED: 'rejected',
}
const RATINGS = ['1 — Poor', '2 — Below average', '3 — Average', '4 — Good', '5 — Excellent']

/** Team In-charge: rate each team member monthly and suggest incentives and extra days. */
export function MyTeamPage() {
  const [month, setMonth] = useState(thisMonth())
  const [search, setSearch] = useState('')
  const [y, m] = month.split('-').map(Number)
  const { data, isLoading } = useQuery({ queryKey: ['my-team', month], queryFn: () => teamApi.my(m, y) })
  const q = search.trim().toLowerCase()
  const shown = (data?.employees ?? []).filter(
    (e) => !q || e.fullName.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q),
  )
  const rated = (data?.employees ?? []).filter((e) => e.progress).length

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">My Team</h1>
        <p className="text-sm text-text-secondary">
          {data?.assignments.length
            ? data.assignments.map((a) => `${a.department} / ${a.designation}`).join(' · ')
            : 'No departments or designations assigned yet. Ask IT to assign them.'}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="team-month">Month</Label>
          <Input id="team-month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </div>
        <Input className="max-w-xs" placeholder="Search name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="pb-2 text-sm text-text-secondary">
          {data ? `${data.employees.length} staff · ${rated} rated this month` : ''}
        </span>
      </div>
      {isLoading ? <p className="text-sm">Loading…</p> : null}
      {data && shown.length === 0 ? <p className="text-sm text-text-secondary">No staff</p> : null}
      <div className="space-y-3">
        {data ? shown.map((e) => <MemberCard key={`${e.id}-${month}`} e={e} team={data} month={m} year={y} />) : null}
      </div>
    </div>
  )
}

function MemberCard({ e, team, month, year }: { e: MyTeamEmployee; team: MyTeam; month: number; year: number }) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['my-team'] })
  const [rating, setRating] = useState(e.progress ? String(e.progress.rating) : '')
  const [remarks, setRemarks] = useState(e.progress?.remarks ?? '')
  const [typeId, setTypeId] = useState(team.incentiveTypes[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [incentiveNote, setIncentiveNote] = useState('')
  const [cut, setCut] = useState('')
  const [cutNote, setCutNote] = useState('')
  const [day, setDay] = useState('')
  const [dayNote, setDayNote] = useState('')
  const first = `${year}-${String(month).padStart(2, '0')}-01`
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  const photo = resolveFileUrl(e.photoUrl)

  const saveRating = useMutation({
    mutationFn: () => teamApi.saveProgress({ employeeId: e.id, month, year, rating: Number(rating), remarks: remarks.trim() }),
    onSuccess: () => {
      toast({ title: `Rating saved for ${e.fullName}` })
      refresh()
    },
    onError: (err: ApiError) => toast({ title: 'Could not save', description: errorText(err), variant: 'destructive' }),
  })
  const suggest = useMutation({
    mutationFn: () =>
      incentiveManagementApi.suggest({
        employeeId: e.id,
        kind: 'INCENTIVE',
        typeId,
        month,
        year,
        amount: Number(amount),
        note: incentiveNote.trim() || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Incentive suggestion sent for approval' })
      setAmount('')
      setIncentiveNote('')
      refresh()
    },
    onError: (err: ApiError) => toast({ title: 'Could not send', description: errorText(err), variant: 'destructive' }),
  })
  const deduction = useMutation({
    mutationFn: () =>
      incentiveManagementApi.suggest({
        employeeId: e.id,
        kind: 'DEDUCTION',
        typeId: DEDUCTION_TYPE_ID,
        month,
        year,
        amount: Number(cut),
        note: cutNote.trim(),
      }),
    onSuccess: () => {
      toast({ title: 'Deduction suggestion sent to Finance' })
      setCut('')
      setCutNote('')
      refresh()
    },
    onError: (err: ApiError) => toast({ title: 'Could not send', description: errorText(err), variant: 'destructive' }),
  })
  const extraDay = useMutation({
    mutationFn: () => additionalWorkingDaysApi.create({ employeeId: e.id, date: day, note: dayNote.trim() || undefined }),
    onSuccess: () => {
      toast({ title: 'Extra day sent to HR Operations for approval' })
      setDay('')
      setDayNote('')
      refresh()
    },
    onError: (err: ApiError) => toast({ title: 'Could not send', description: errorText(err), variant: 'destructive' }),
  })

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          {photo ? (
            <img src={photo} alt="" className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 font-semibold">
              {e.fullName.charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <p className="font-medium">
              {e.fullName} <span className="text-sm font-normal text-text-secondary">({e.employeeCode})</span>
            </p>
            <p className="text-sm text-text-secondary">
              {e.designation ?? '—'} · {e.branch ?? '—'}
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">Monthly rating</p>
            <select
              aria-label={`Rating for ${e.fullName}`}
              className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
              value={rating}
              onChange={(ev) => setRating(ev.target.value)}
            >
              <option value="">Choose 1 to 5</option>
              {RATINGS.map((r, i) => (
                <option key={r} value={i + 1}>
                  {r}
                </option>
              ))}
            </select>
            <Input placeholder="Remarks" value={remarks} onChange={(ev) => setRemarks(ev.target.value)} />
            <Button size="sm" disabled={!rating || saveRating.isPending} onClick={() => saveRating.mutate()}>
              {saveRating.isPending ? 'Saving...' : e.progress ? 'Update rating' : 'Save rating'}
            </Button>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">Suggest incentive</p>
            <div className="flex gap-2">
              <select
                aria-label="Incentive type"
                className="h-10 flex-1 rounded-md border border-border bg-white px-2 text-sm"
                value={typeId}
                onChange={(ev) => setTypeId(ev.target.value)}
              >
                {team.incentiveTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <Input
                className="w-28"
                type="number"
                min={1}
                placeholder="PKR"
                aria-label="Amount"
                value={amount}
                onChange={(ev) => setAmount(ev.target.value)}
              />
            </div>
            <Input placeholder="Why (optional)" value={incentiveNote} onChange={(ev) => setIncentiveNote(ev.target.value)} />
            <Button size="sm" disabled={!typeId || !(Number(amount) > 0) || suggest.isPending} onClick={() => suggest.mutate()}>
              {suggest.isPending ? 'Sending...' : 'Send suggestion'}
            </Button>
            {e.suggestions.filter((s) => s.kind === 'INCENTIVE').map((s, i) => (
              <p key={i} className="text-xs text-text-secondary">
                {s.type} {pkr(s.amount)} — {STATUS[s.status] ?? s.status}
                {s.approvedAmount != null && s.approvedAmount !== s.amount ? ` at ${pkr(s.approvedAmount)}` : ''}
              </p>
            ))}
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">Suggest deduction</p>
            <Input
              type="number"
              min={1}
              placeholder="PKR"
              aria-label="Deduction amount"
              value={cut}
              onChange={(ev) => setCut(ev.target.value)}
            />
            <Input placeholder="Reason (required)" value={cutNote} onChange={(ev) => setCutNote(ev.target.value)} />
            <Button
              size="sm"
              disabled={!(Number(cut) > 0) || cutNote.trim().length < 3 || deduction.isPending}
              onClick={() => deduction.mutate()}
            >
              {deduction.isPending ? 'Sending...' : 'Send to Finance'}
            </Button>
            {e.suggestions.filter((s) => s.kind === 'DEDUCTION').map((s, i) => (
              <p key={i} className="text-xs text-text-secondary">
                {pkr(s.amount)} — {STATUS[s.status] ?? s.status}
                {s.approvedAmount != null && s.approvedAmount !== s.amount ? ` at ${pkr(s.approvedAmount)}` : ''}
              </p>
            ))}
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">Suggest extra day (extra duty)</p>
            <Input type="date" min={first} max={last} aria-label="Extra day date" value={day} onChange={(ev) => setDay(ev.target.value)} />
            <Input placeholder="Duty done (optional)" value={dayNote} onChange={(ev) => setDayNote(ev.target.value)} />
            <Button size="sm" disabled={!day || extraDay.isPending} onClick={() => extraDay.mutate()}>
              {extraDay.isPending ? 'Sending...' : 'Send to HR Operations'}
            </Button>
            {e.extraDays.map((d) => (
              <p key={d.id} className="text-xs text-text-secondary">
                {d.date} — {STATUS[d.status] ?? d.status}
                {d.note ? ` · ${d.note}` : ''}
              </p>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
