import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { extraTimeApi } from '@/api/endpoints/additionalWorkingDays'
import { inboxApi, type InboxItem, type InboxTab } from '@/api/endpoints/inbox'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errorText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}
const TABS: Array<{ value: InboxTab; label: string; hint: string }> = [
  { value: 'todo', label: 'To do', hint: 'Waiting for your decision' },
  { value: 'sent', label: 'Sent by me', hint: 'What you entered and where it is now (last 90 days)' },
  { value: 'done', label: 'Decided by me', hint: 'What you approved or rejected, and what happened next' },
]
const TYPE_LABEL: Record<InboxItem['type'], string> = { EXTRA_DAY: 'Extra day', OVERTIME: 'Overtime' }
const STEP_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  ESCALATED: 'bg-blue-100 text-blue-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
}
const when = (iso: string | null) => (iso ? format(new Date(iso), 'dd MMM yyyy, h:mm a') : '')

/** One Inbox for every login: work waiting for me, what I sent, what I decided — each with its trail. */
export function InboxPage() {
  const [tab, setTab] = useState<InboxTab>('todo')
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['inbox', tab], queryFn: () => inboxApi.list(tab) })
  const q = search.trim().toLowerCase()
  const items = (data?.items ?? []).filter(
    (i) =>
      (!type || i.type === type) &&
      (!q || i.employee.name.toLowerCase().includes(q) || i.employee.code.toLowerCase().includes(q)),
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <p className="text-sm text-text-secondary">
          Everything that needs you, everything you sent and where it is now, with its full trail. Extra days and
          overtime are here now; pay requests, leaves, transfers, letters and loans will join step by step.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1">
        {TABS.map((t) => (
          <Button
            key={t.value}
            size="sm"
            variant={tab === t.value ? 'default' : 'ghost'}
            className={tab === t.value ? 'bg-primary hover:bg-primary-dark' : 'text-text-secondary'}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-text-secondary">{TABS.find((t) => t.value === tab)?.hint}</p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Type"
          className="h-10 rounded-md border border-border bg-white px-3 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">All types</option>
          <option value="EXTRA_DAY">Extra day</option>
          <option value="OVERTIME">Overtime</option>
        </select>
        <Input className="max-w-xs" placeholder="Search name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="text-sm text-text-secondary">{data ? `${items.length} item(s)` : ''}</span>
      </div>

      {isLoading ? <p className="text-sm">Loading…</p> : null}
      {data && items.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-text-secondary">
            {tab === 'todo' ? 'Nothing is waiting for you.' : 'Nothing here yet.'}
          </CardContent>
        </Card>
      ) : null}
      <div className="space-y-2">
        {items.map((i) => (
          <InboxRow key={i.key} item={i} />
        ))}
      </div>
    </div>
  )
}

function InboxRow({ item: i }: { item: InboxItem }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      approve
        ? extraTimeApi.approve(i.kind, i.id, note.trim() || undefined)
        : extraTimeApi.reject(i.kind, i.id, note.trim() || undefined),
    onSuccess: (_r, approve) => {
      toast({ title: approve ? 'Approved' : 'Rejected' })
      queryClient.invalidateQueries({ queryKey: ['inbox'] })
      queryClient.invalidateQueries({ queryKey: ['inbox-count'] })
      queryClient.invalidateQueries({ queryKey: ['extra-time-pending'] })
    },
    onError: (err: ApiError) => toast({ title: 'Could not save', description: errorText(err), variant: 'destructive' }),
  })

  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium">{TYPE_LABEL[i.type]}</span>
              <Link to={`/employees/${i.employee.id}`} className="font-medium text-primary hover:underline">
                {i.employee.name}
              </Link>
              <span className="text-xs text-text-secondary">
                {i.employee.code}
                {i.employee.branch ? ` · ${i.employee.branch}` : ''}
              </span>
            </div>
            <p className="text-sm">
              {format(new Date(i.date), 'dd MMM yyyy')}
              {i.minutes != null ? ` · ${Math.floor(i.minutes / 60)}h ${i.minutes % 60}m` : ''}
              {i.note ? <span className="text-text-secondary"> · {i.note}</span> : null}
            </p>
            {i.requestedBy ? <p className="text-xs text-text-secondary">Entered by {i.requestedBy}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${STEP_STYLE[i.status] ?? 'bg-gray-100'}`}>{i.step}</span>
            <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
              {open ? 'Hide trail' : 'Trail'}
            </Button>
          </div>
        </div>

        {open ? (
          <ol className="space-y-1 border-l-2 border-border pl-3">
            {i.trail.map((t, n) => (
              <li key={n} className="text-sm">
                <span className={t.at ? 'font-medium' : 'italic text-text-secondary'}>{t.text}</span>
                {t.by ? <span className="text-text-secondary"> · {t.by}</span> : null}
                {t.at ? <span className="text-text-secondary"> · {when(t.at)}</span> : null}
                {t.note ? <div className="text-xs text-text-secondary">Note: {t.note}</div> : null}
              </li>
            ))}
          </ol>
        ) : null}

        {i.canDecide ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
            <Input className="max-w-sm" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate(true)}>
              Approve
            </Button>
            <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate(false)}>
              Reject
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
