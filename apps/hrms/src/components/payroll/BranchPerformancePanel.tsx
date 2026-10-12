import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  doctorPerformanceApi,
  type BranchPerformanceRow,
  type BranchShift,
  type ShiftFigures,
} from '@/api/endpoints/doctorPerformance'
import { incentivesApi } from '@/api/endpoints/incentives'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { saveBlobFrom } from '@/lib/downloadLetterPdf'
import { cn } from '@/lib/utils'

type ShiftKey = Exclude<keyof ShiftFigures, 'note'>
const SHIFT_FIELDS: Array<{ key: ShiftKey; label: string; money?: boolean }> = [
  { key: 'patients', label: 'Patients' },
  { key: 'labCollection', label: 'Lab collection', money: true },
  { key: 'collection', label: 'Total collection', money: true },
]
const num = (n: number) => Math.round(n).toLocaleString('en-PK')

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: unknown) => {
  const msg = (err as ApiError).response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}

function Change({ prev, cur }: { prev: number | null; cur: number | null }) {
  const pct = prev && cur != null ? Math.round(((cur - prev) / prev) * 100) : null
  return (
    <div className="text-xs text-muted-foreground tabular-nums">
      last {prev == null ? '—' : num(prev)}
      {pct ? (
        <span className={cn('ml-1 font-medium', pct > 0 ? 'text-green-700' : 'text-red-600')}>
          {pct > 0 ? '▲' : '▼'}
          {Math.abs(pct)}%
        </span>
      ) : null}
    </div>
  )
}

/** Open (download) a branch's progress report. */
export function openBranchReport(report: { id: string; fileName: string }) {
  saveBlobFrom(() => doctorPerformanceApi.report(report.id), report.fileName).catch((err) =>
    toast({ title: 'Could not open report', description: errText(err), variant: 'destructive' }),
  )
}

/**
 * Branch progress by shift: Day and Night admin are judged separately.
 * Finance enters patients and collections and uploads the monthly progress
 * report; executives compare with last month and give Admin Officers incentives.
 */
export function BranchPerformancePanel({
  year,
  month,
  canEnter,
  canIncentive,
  incentiveTypeId,
}: {
  year: number
  month: number
  canEnter: boolean
  canIncentive: boolean
  incentiveTypeId?: string
}) {
  const queryClient = useQueryClient()
  const [drafts, setDrafts] = useState<Record<string, Partial<ShiftFigures>>>({})
  const [rewards, setRewards] = useState<Record<string, number>>({})
  const { data, isLoading } = useQuery({
    queryKey: ['branch-performance', year, month],
    queryFn: () => doctorPerformanceApi.branches({ year, month }),
  })

  const key = (branchId: string, shift: BranchShift) => `${branchId}:${shift}`
  const current = (r: BranchPerformanceRow, shift: BranchShift) =>
    r.shifts.find((s) => s.shift === shift)
  const value = (r: BranchPerformanceRow, shift: BranchShift, k: ShiftKey) =>
    drafts[key(r.branch.id, shift)]?.[k] ?? current(r, shift)?.current?.[k] ?? 0
  const changed = Object.keys(drafts)

  const save = useMutation({
    mutationFn: () =>
      doctorPerformanceApi.saveBranches({
        year,
        month,
        rows: changed.map((k) => {
          const [branchId, shift] = k.split(':') as [string, BranchShift]
          const r = data!.rows.find((x) => x.branch.id === branchId)!
          return {
            branchId,
            shift,
            patients: value(r, shift, 'patients'),
            labCollection: value(r, shift, 'labCollection'),
            collection: value(r, shift, 'collection'),
          }
        }),
      }),
    onSuccess: () => {
      toast({ title: 'Branch figures saved' })
      setDrafts({})
      queryClient.invalidateQueries({ queryKey: ['branch-performance'] })
    },
    onError: (err) =>
      toast({ title: 'Could not save', description: errText(err), variant: 'destructive' }),
  })

  const upload = useMutation({
    mutationFn: ({ branchId, file }: { branchId: string; file: File }) =>
      doctorPerformanceApi.uploadReport(branchId, { year, month }, file),
    onSuccess: () => {
      toast({ title: 'Progress report uploaded' })
      queryClient.invalidateQueries({ queryKey: ['branch-performance'] })
    },
    onError: (err) =>
      toast({ title: 'Upload failed', description: errText(err), variant: 'destructive' }),
  })

  const rewardRows = Object.entries(rewards).filter(([, v]) => v > 0)
  const give = useMutation({
    mutationFn: async () => {
      const failed: string[] = []
      for (const [employeeId, amount] of rewardRows) {
        try {
          await incentivesApi.create({
            employeeId,
            month,
            year,
            amount,
            typeId: incentiveTypeId,
            reason: 'Branch progress review',
          })
        } catch (err) {
          failed.push(errText(err))
        }
      }
      return failed
    },
    onSuccess: (failed) => {
      toast({
        title: `${rewardRows.length - failed.length} incentive(s) added${failed.length ? `, ${failed.length} failed` : ''}`,
        description: failed.join('\n') || undefined,
        variant: failed.length ? 'destructive' : undefined,
      })
      setRewards({})
      queryClient.invalidateQueries({ queryKey: ['branch-performance'] })
      queryClient.invalidateQueries({ queryKey: ['incentives'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
    },
  })

  if (isLoading) return <p className="text-center text-sm">Loading…</p>

  return (
    <div className="space-y-3">
      {canEnter || canIncentive ? (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-background/95 p-2 text-sm">
          {canEnter ? (
            <Button size="sm" disabled={!changed.length || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : `Save figures (${changed.length})`}
            </Button>
          ) : null}
          {canIncentive ? (
            <Button size="sm" disabled={!rewardRows.length || give.isPending} onClick={() => give.mutate()}>
              {give.isPending
                ? 'Saving…'
                : `Save incentives · PKR ${num(rewardRows.reduce((s, [, v]) => s + v, 0))}`}
            </Button>
          ) : null}
        </div>
      ) : null}

      {(data?.rows ?? []).map((r) => (
        <Card key={r.branch.id}>
          <CardContent className="space-y-3 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">{r.branch.name}</div>
              <div className="flex flex-wrap items-center gap-2">
                {r.report ? (
                  <button
                    type="button"
                    className="text-xs text-primary underline"
                    onClick={() => openBranchReport(r.report!)}
                  >
                    Progress report: {r.report.fileName}
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">No progress report</span>
                )}
                {canEnter ? (
                  <label className="cursor-pointer text-xs text-primary underline">
                    {r.report ? 'Replace' : 'Upload report'}
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) upload.mutate({ branchId: r.branch.id, file })
                        e.target.value = ''
                      }}
                    />
                  </label>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {(['DAY', 'NIGHT'] as BranchShift[]).map((shift) => {
                const s = current(r, shift)
                return (
                  <div key={shift} className="rounded border p-2">
                    <div className="mb-1 text-xs font-semibold">{shift === 'DAY' ? 'Day' : 'Night'}</div>
                    <div className="grid grid-cols-3 gap-2">
                      {SHIFT_FIELDS.map((f) => (
                        <div key={f.key}>
                          <div className="text-xs text-muted-foreground">{f.label}</div>
                          {canEnter ? (
                            <Input
                              type="number"
                              min={0}
                              step={f.money ? '0.01' : '1'}
                              aria-label={`${r.branch.name} ${shift} ${f.label}`}
                              className="h-8 tabular-nums"
                              value={value(r, shift, f.key)}
                              onChange={(e) =>
                                setDrafts((d) => ({
                                  ...d,
                                  [key(r.branch.id, shift)]: {
                                    ...d[key(r.branch.id, shift)],
                                    [f.key]: Math.max(0, Number(e.target.value) || 0),
                                  },
                                }))
                              }
                            />
                          ) : (
                            <div className="font-semibold tabular-nums">
                              {s?.current ? num(s.current[f.key]) : '—'}
                            </div>
                          )}
                          <Change prev={s?.previous?.[f.key] ?? null} cur={s?.current?.[f.key] ?? null} />
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            {r.adminOfficers.length ? (
              <div className="space-y-1">
                <div className="text-xs font-semibold">Admin Officers</div>
                {r.adminOfficers.map((o) => (
                  <div key={o.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-[160px]">
                      {o.fullName} <span className="text-xs text-muted-foreground">{o.employeeCode}</span>
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      this month {num(o.incentive)} · last {num(o.previousIncentive)}
                    </span>
                    {canIncentive ? (
                      <Input
                        type="number"
                        min={0}
                        placeholder="Incentive"
                        aria-label={`Incentive for ${o.fullName}`}
                        className="h-8 w-28 tabular-nums"
                        value={rewards[o.id] || ''}
                        onChange={(e) =>
                          setRewards((s) => ({ ...s, [o.id]: Math.max(0, Number(e.target.value) || 0) }))
                        }
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
