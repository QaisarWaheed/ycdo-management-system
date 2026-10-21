import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { teamApi, type TeamPair } from '@/api/endpoints/team'
import { userAccessApi } from '@/api/endpoints/userAccess'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errorText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}
const pairKey = (p: { departmentId: string; designation: string }) => `${p.departmentId}|${p.designation}`

/**
 * IT: give department + designation pairs (all branches) to Team In-charge
 * logins. A pair belongs to one login; once assigned it leaves the Unassigned list.
 */
export function TeamAssignmentsPage() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['team-assignments'], queryFn: teamApi.options })
  const [loginId, setLoginId] = useState('')
  const [newLogin, setNewLogin] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [removing, setRemoving] = useState<TeamPair>()

  const departments = data?.departments ?? []
  const pairs = data?.pairs ?? []
  const deptName = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments])
  const deptsWithStaff = departments.filter((d) => pairs.some((p) => p.departmentId === d.id))
  const deptPairs = pairs.filter((p) => p.departmentId === departmentId)
  const unassigned = pairs.filter(
    (p) =>
      !p.assignment &&
      (!search.trim() ||
        `${deptName.get(p.departmentId) ?? ''} ${p.designation}`.toLowerCase().includes(search.trim().toLowerCase())),
  )
  const byLogin = (data?.logins ?? []).map((l) => ({ ...l, pairs: pairs.filter((p) => p.assignment?.userId === l.id) }))
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['team-assignments'] })

  const createLogin = useMutation({
    mutationFn: () => userAccessApi.createSystemLogin({ email: email.trim(), password, role: 'TEAM_INCHARGE' }),
    onSuccess: (user) => {
      toast({ title: 'Team In-charge login created' })
      setNewLogin(false)
      setEmail('')
      setPassword('')
      setLoginId(user.id)
      refresh()
    },
    onError: (err: ApiError) => toast({ title: 'Could not create login', description: errorText(err), variant: 'destructive' }),
  })
  const assign = useMutation({
    mutationFn: () =>
      teamApi.assign(
        loginId,
        deptPairs.filter((p) => picked.includes(pairKey(p))).map((p) => ({ departmentId: p.departmentId, designation: p.designation })),
      ),
    onSuccess: (res) => {
      toast({ title: `${res.assigned} designation${res.assigned === 1 ? '' : 's'} assigned` })
      setPicked([])
      refresh()
    },
    onError: (err: ApiError) => toast({ title: 'Could not assign', description: errorText(err), variant: 'destructive' }),
  })
  const unassign = useMutation({
    mutationFn: (id: string) => teamApi.unassign(id),
    onSuccess: () => {
      setRemoving(undefined)
      toast({ title: 'Removed; it is back in Unassigned' })
      refresh()
    },
    onError: (err: ApiError) => toast({ title: 'Could not remove', description: errorText(err), variant: 'destructive' }),
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Team Assignments</h1>
        <p className="text-sm text-text-secondary">
          Give departments and designations to a Team In-charge login. That login sees those employees in every branch,
          rates them each month and suggests incentives and extra days.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">1. Team In-charge login</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-64 flex-1 space-y-1">
              <Label htmlFor="team-login">Login</Label>
              <select
                id="team-login"
                className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
              >
                <option value="">Choose a Team In-charge login</option>
                {(data?.logins ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name ? `${l.name} (${l.email})` : l.email}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="outline" onClick={() => setNewLogin((v) => !v)}>
              {newLogin ? 'Cancel' : 'New login'}
            </Button>
          </div>
          {newLogin ? (
            <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="team-email">Email</Label>
                <Input id="team-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="team-password">Password (min 6)</Label>
                <Input id="team-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button
                  disabled={!email.includes('@') || password.length < 6 || createLogin.isPending}
                  onClick={() => createLogin.mutate()}
                >
                  {createLogin.isPending ? 'Creating...' : 'Create login'}
                </Button>
              </div>
              <p className="text-xs text-text-secondary sm:col-span-3">
                The login gets the Team In-charge role. An existing login can get it as an extra role in Login Access.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">2. Departments and designations</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-text-secondary">Departments</p>
            <div className="max-h-96 divide-y divide-border overflow-y-auto rounded border border-border">
              {isLoading ? <p className="p-3 text-sm">Loading…</p> : null}
              {deptsWithStaff.map((d) => {
                const free = pairs.filter((p) => p.departmentId === d.id && !p.assignment).length
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      setDepartmentId(d.id)
                      setPicked([])
                    }}
                    className={`flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                      departmentId === d.id ? 'bg-primary/10 font-medium' : ''
                    }`}
                  >
                    <span>{d.name}</span>
                    <span className="text-xs text-text-secondary">{free} unassigned</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-text-secondary">
              Designations {departmentId ? `in ${deptName.get(departmentId)}` : ''}
            </p>
            <div className="max-h-96 divide-y divide-border overflow-y-auto rounded border border-border">
              {!departmentId ? <p className="p-3 text-sm text-text-secondary">Choose a department</p> : null}
              {deptPairs.map((p) => (
                <label key={pairKey(p)} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      disabled={!!p.assignment}
                      checked={picked.includes(pairKey(p))}
                      onChange={(e) =>
                        setPicked((prev) => (e.target.checked ? [...prev, pairKey(p)] : prev.filter((k) => k !== pairKey(p))))
                      }
                    />
                    {p.designation}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {p.employees} staff{p.assignment ? ` · ${p.assignment.email}` : ''}
                  </span>
                </label>
              ))}
            </div>
            <Button className="mt-2" disabled={!loginId || !picked.length || assign.isPending} onClick={() => assign.mutate()}>
              {assign.isPending ? 'Assigning...' : `Assign ${picked.length || ''} to the chosen login`}
            </Button>
            {!loginId ? <p className="mt-1 text-xs text-text-secondary">Choose a login in step 1 first.</p> : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Assigned</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {byLogin.filter((l) => l.pairs.length).length === 0 ? (
              <p className="text-sm text-text-secondary">Nothing assigned yet</p>
            ) : null}
            {byLogin
              .filter((l) => l.pairs.length)
              .map((l) => (
                <div key={l.id} className="rounded border border-border">
                  <p className="border-b border-border bg-gray-50 px-3 py-1.5 text-sm font-medium">
                    {l.name ? `${l.name} (${l.email})` : l.email}
                  </p>
                  {l.pairs.map((p) => (
                    <div key={pairKey(p)} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                      <span>
                        {deptName.get(p.departmentId)} / {p.designation}
                        <span className="ml-1 text-xs text-text-secondary">({p.employees} staff)</span>
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(p)}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Unassigned ({unassigned.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input placeholder="Search department or designation" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-96 divide-y divide-border overflow-y-auto rounded border border-border">
              {unassigned.map((p) => (
                <div key={pairKey(p)} className="flex justify-between gap-2 px-3 py-1.5 text-sm">
                  <span>
                    {deptName.get(p.departmentId)} / {p.designation}
                  </span>
                  <span className="text-xs text-text-secondary">{p.employees} staff</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={removing != null}
        title="Remove this assignment?"
        description={
          removing
            ? `${deptName.get(removing.departmentId)} / ${removing.designation} will be taken from ${removing.assignment?.email}.`
            : ''
        }
        confirmLabel="Remove"
        confirmVariant="destructive"
        loading={unassign.isPending}
        onCancel={() => setRemoving(undefined)}
        onConfirm={() => removing?.assignment && unassign.mutate(removing.assignment.id)}
      />
    </div>
  )
}
