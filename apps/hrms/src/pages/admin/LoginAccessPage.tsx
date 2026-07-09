import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Eye, EyeOff, Plus, Settings2, Shield } from 'lucide-react'
import { branchesApi } from '@/api/endpoints/branches'
import { projectsApi } from '@/api/endpoints/projects'
import {
  userAccessApi,
  type AppPermission,
  type PermissionOverrideInput,
  type UserAccessRecord,
} from '@/api/endpoints/userAccess'
import { TablePagination } from '@/components/common/TablePagination'
import { TableRecordCount } from '@/components/common/TableRecordCount'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { useDebounce } from '@/hooks/useDebounce'
import { usePagination } from '@/hooks/usePagination'
import { formatBranchLabel } from '@/lib/formatBranchLabel'

type LoginTypeFilter = 'all' | 'employee' | 'system'
type PermissionMode = 'default' | 'grant' | 'deny'

function permissionMode(
  permission: AppPermission,
  overrides: { permission: AppPermission; granted: boolean }[],
): PermissionMode {
  const override = overrides.find((o) => o.permission === permission)
  if (!override) return 'default'
  return override.granted ? 'grant' : 'deny'
}

function ManageAccessDialog({
  userId,
  open,
  onOpenChange,
}: {
  userId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [newPassword, setNewPassword] = useState('')
  const [permissionModes, setPermissionModes] = useState<
    Record<AppPermission, PermissionMode>
  >({} as Record<AppPermission, PermissionMode>)
  const [role, setRole] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [branchId, setBranchId] = useState('')

  const { data: meta } = useQuery({
    queryKey: ['user-access-meta'],
    queryFn: () => userAccessApi.getMeta(),
  })

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const { data: user, isLoading } = useQuery({
    queryKey: ['user-access', userId],
    queryFn: () => userAccessApi.getOne(userId!),
    enabled: open && !!userId,
  })

  useEffect(() => {
    if (!user || !open) return
    setRole(user.role)
    setIsActive(user.isActive)
    setBranchId(user.branchId ?? '')
    const modes = {} as Record<AppPermission, PermissionMode>
    for (const p of user.permissions) {
      modes[p.permission] = p.granted ? 'grant' : 'deny'
    }
    setPermissionModes(modes)
  }, [user, open])

  useEffect(() => {
    if (!open) {
      setRole('')
      setNewPassword('')
      setPermissionModes({} as Record<AppPermission, PermissionMode>)
    }
  }, [open])

  const saveMutation = useMutation({
    mutationFn: () => {
      const permissions: PermissionOverrideInput[] =
        meta?.permissions.map(({ permission }) => {
          const mode = permissionModes[permission] ?? 'default'
          if (mode === 'default') return { permission, granted: null }
          return { permission, granted: mode === 'grant' }
        }) ?? []

      return userAccessApi.update(userId!, {
        role,
        isActive,
        branchId: branchId || null,
        permissions,
      })
    },
    onSuccess: () => {
      toast({ title: 'Access settings saved' })
      queryClient.invalidateQueries({ queryKey: ['login-access'] })
      queryClient.invalidateQueries({ queryKey: ['user-access', userId] })
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to save',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const passwordMutation = useMutation({
    mutationFn: () => userAccessApi.resetPassword(userId!, newPassword),
    onSuccess: () => {
      toast({ title: 'Password updated' })
      setNewPassword('')
      queryClient.invalidateQueries({ queryKey: ['login-access'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to reset password',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const handleClose = (v: boolean) => {
    if (!v) {
      setRole('')
      setNewPassword('')
      setPermissionModes({} as Record<AppPermission, PermissionMode>)
    }
    onOpenChange(v)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Login Access</DialogTitle>
        </DialogHeader>

        {isLoading || !user ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <p className="font-medium">{user.email}</p>
              <p className="text-sm text-text-secondary">
                {user.employee
                  ? `${user.employee.fullName} (${user.employee.employeeCode})`
                  : 'System login'}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(meta?.assignableRoles ?? []).map((r) => (
                      <SelectItem key={r} value={r}>
                        {r.replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Account status</Label>
                <Select
                  value={isActive ? 'active' : 'disabled'}
                  onValueChange={(v) => setIsActive(v === 'active')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active — can sign in</SelectItem>
                    <SelectItem value="disabled">Disabled — access revoked</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {!user.employeeId && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Branch (optional)</Label>
                  <Select
                    value={branchId || 'none'}
                    onValueChange={(v) => setBranchId(v === 'none' ? '' : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="No branch" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No branch</SelectItem>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {formatBranchLabel(b)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <Label className="text-base">Permissions</Label>
                <p className="text-xs text-text-secondary">
                  Default follows the role. Grant or deny to override for this login
                  only — e.g. allow one HR to mark attendance and block another.
                </p>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border p-3">
                {user.effectivePermissions.map((perm) => {
                  const mode =
                    permissionModes[perm.permission] ??
                    permissionMode(perm.permission, user.permissions)
                  return (
                    <div
                      key={perm.permission}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{perm.label}</p>
                        <p className="text-xs text-text-secondary">
                          Currently: {perm.effective ? 'Allowed' : 'Not allowed'}
                          {perm.source !== 'role' &&
                            ` (${perm.source === 'override_grant' ? 'granted' : 'denied'} override)`}
                        </p>
                      </div>
                      <Select
                        value={mode}
                        onValueChange={(v) =>
                          setPermissionModes((prev) => ({
                            ...prev,
                            [perm.permission]: v as PermissionMode,
                          }))
                        }
                      >
                        <SelectTrigger className="w-[130px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Default</SelectItem>
                          <SelectItem value="grant">Grant</SelectItem>
                          <SelectItem value="deny">Deny</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <Label>Reset password</Label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                />
                <Button
                  variant="outline"
                  disabled={newPassword.length < 6 || passwordMutation.isPending}
                  onClick={() => passwordMutation.mutate()}
                >
                  Reset
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={saveMutation.isPending || !user}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateSystemLoginDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('')
  const [branchId, setBranchId] = useState('')

  const { data: meta } = useQuery({
    queryKey: ['user-access-meta'],
    queryFn: () => userAccessApi.getMeta(),
  })

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const mutation = useMutation({
    mutationFn: () =>
      userAccessApi.createSystemLogin({
        email,
        password,
        role,
        branchId: branchId || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'System login created' })
      setEmail('')
      setPassword('')
      setRole('')
      setBranchId('')
      onOpenChange(false)
      queryClient.invalidateQueries({ queryKey: ['login-access'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to create login',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setEmail('')
          setPassword('')
          setRole('')
          setBranchId('')
        }
        onOpenChange(v)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create System Login</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Password</Label>
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {(meta?.assignableRoles ?? []).map((r) => (
                  <SelectItem key={r} value={r}>
                    {r.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Branch (optional)</Label>
            <Select
              value={branchId || 'none'}
              onValueChange={(v) => setBranchId(v === 'none' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="No branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No branch</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {formatBranchLabel(b)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={
              !email ||
              password.length < 6 ||
              !role ||
              mutation.isPending
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Creating...' : 'Create login'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function LoginAccessPage() {
  const [loginType, setLoginType] = useState<LoginTypeFilter>('all')
  const [projectId, setProjectId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [search, setSearch] = useState('')
  const [manageUserId, setManageUserId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>(
    {},
  )

  const debouncedSearch = useDebounce(search, 300)

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getAll(),
  })

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const filteredBranches = useMemo(() => {
    if (!projectId) return branches
    return branches.filter((b) => b.projectId === projectId)
  }, [branches, projectId])

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['login-access', loginType, projectId, branchId, debouncedSearch],
    queryFn: () =>
      userAccessApi.getAll({
        employeeOnly: loginType === 'employee',
        systemOnly: loginType === 'system',
        projectId: projectId || undefined,
        branchId: branchId || undefined,
        search: debouncedSearch || undefined,
      }),
  })

  const { page, setPage, totalPages, paginated, total } = usePagination(
    records,
    [loginType, projectId, branchId, debouncedSearch],
  )

  const togglePassword = (id: string) => {
    setVisiblePasswords((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
            <Shield className="h-7 w-7 text-primary" />
            Login Access Control
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Manage all logins — disable accounts, assign roles, and set per-user
            permissions.
          </p>
        </div>
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Create system login
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label>Login type</Label>
          <Select
            value={loginType}
            onValueChange={(v) => setLoginType(v as LoginTypeFilter)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All logins</SelectItem>
              <SelectItem value="employee">Employee (Portal)</SelectItem>
              <SelectItem value="system">System (HRMS)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Project</Label>
          <Select
            value={projectId || 'all'}
            onValueChange={(v) => {
              setProjectId(v === 'all' ? '' : v)
              setBranchId('')
            }}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Branch</Label>
          <Select
            value={branchId || 'all'}
            onValueChange={(v) => setBranchId(v === 'all' ? '' : v)}
          >
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="All branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {filteredBranches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {formatBranchLabel(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[220px] flex-1 space-y-1">
          <Label>Search</Label>
          <Input
            placeholder="Email, name, or employee code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <TableRecordCount count={total} label="login account" />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Password</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(8)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-text-secondary">
                    No login accounts found
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((record: UserAccessRecord) => (
                  <TableRow key={record.id}>
                    <TableCell>
                      <Badge variant="outline">
                        {record.employeeId ? 'Employee' : 'System'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{record.email}</p>
                      {record.employee && (
                        <EmployeeNameLink
                          employee={{
                            id: record.employeeId!,
                            fullName: record.employee.fullName,
                            employeeCode: record.employee.employeeCode,
                          }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {record.branch ? formatBranchLabel(record.branch) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {record.role.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          record.isActive
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }
                      >
                        {record.isActive ? 'Active' : 'Disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {record.passwordRecord ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">
                            {visiblePasswords[record.id]
                              ? record.passwordRecord.plainText
                              : '••••••••'}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => togglePassword(record.id)}
                          >
                            {visiblePasswords[record.id] ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {record.lastLogin
                        ? format(new Date(record.lastLogin), 'dd/MM/yyyy HH:mm')
                        : 'Never'}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setManageUserId(record.id)}
                      >
                        <Settings2 className="mr-1 h-3.5 w-3.5" />
                        Manage
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <TablePagination
            page={page}
            totalPages={totalPages}
            total={total}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>

      <ManageAccessDialog
        userId={manageUserId}
        open={!!manageUserId}
        onOpenChange={(open) => !open && setManageUserId(null)}
      />

      <CreateSystemLoginDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
