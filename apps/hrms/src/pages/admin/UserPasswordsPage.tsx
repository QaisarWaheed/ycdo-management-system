import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  Eye,
  EyeOff,
  KeyRound,
  MessageCircle,
  Pencil,
} from 'lucide-react'
import { branchesApi } from '@/api/endpoints/branches'
import { projectsApi } from '@/api/endpoints/projects'
import {
  userPasswordsApi,
  type UserPasswordRecord,
} from '@/api/endpoints/userPasswords'
import { PortalCredentialsWhatsAppDialog } from '@/components/admin/PortalCredentialsWhatsAppDialog'
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
import { useAuth } from '@/hooks/useAuth'
import { usePagination } from '@/hooks/usePagination'
import { getApiErrorMessage } from '@/lib/apiErrorMessage'
import { formatBranchLabel } from '@/lib/formatBranchLabel'

function ResetPasswordDialog({
  record,
  open,
  onOpenChange,
}: {
  record: UserPasswordRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [newPassword, setNewPassword] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      userPasswordsApi.resetPassword(record!.userId, newPassword),
    onSuccess: () => {
      toast({ title: 'Password updated' })
      setNewPassword('')
      onOpenChange(false)
      queryClient.invalidateQueries({ queryKey: ['employee-logins'] })
    },
    onError: (err: unknown) => {
      toast({
        title: 'Failed to reset password',
        description: getApiErrorMessage(err, 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setNewPassword('')
        onOpenChange(v)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
        </DialogHeader>
        {record && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Reset password for{' '}
              <span className="font-medium text-text-primary">
                {record.user.email}
              </span>
            </p>
            <div className="space-y-2">
              <Label>New Password</Label>
              <Input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 6 characters"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={newPassword.length < 6 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving...' : 'Update Password'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function UserPasswordsPage() {
  const { hasRole } = useAuth()
  const isSuperAdmin = hasRole(['SUPER_ADMIN'])
  const [projectId, setProjectId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [resetRecord, setResetRecord] = useState<UserPasswordRecord | null>(null)
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>(
    {},
  )
  const [waOpen, setWaOpen] = useState(false)
  const [waEnabled, setWaEnabled] = useState(false)

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
    queryKey: ['employee-logins', projectId, branchId],
    queryFn: () =>
      userPasswordsApi.getAll({
        employeeOnly: true,
        projectId: projectId || undefined,
        branchId: branchId || undefined,
      }),
  })

  const {
    data: waShares,
    isFetching: waLoading,
    refetch: refetchWaShares,
    error: waError,
  } = useQuery({
    queryKey: ['portal-whatsapp-shares', projectId, branchId],
    queryFn: () =>
      userPasswordsApi.getPortalWhatsAppShares({
        projectId: projectId || undefined,
        branchId: branchId || undefined,
      }),
    enabled: waEnabled,
  })

  const { page, setPage, totalPages, paginated, total } = usePagination(
    records,
    [projectId, branchId],
  )

  const togglePassword = (id: string) => {
    setVisiblePasswords((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const startBulkWhatsApp = async () => {
    setWaEnabled(true)
    setWaOpen(true)
    const result = await refetchWaShares()
    if (result.error) {
      toast({
        title: 'Could not prepare WhatsApp links',
        description: getApiErrorMessage(result.error, 'Error'),
        variant: 'destructive',
      })
    }
  }

  const sendOneWhatsApp = async (record: UserPasswordRecord) => {
    try {
      const { item } = await userPasswordsApi.getOnePortalWhatsAppShare(
        record.userId,
      )
      if (!item.ready || !item.waUrl) {
        toast({
          title: 'Cannot open WhatsApp',
          description: item.skipReason ?? 'Missing phone or password',
          variant: 'destructive',
        })
        return
      }
      window.open(item.waUrl, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast({
        title: 'WhatsApp share failed',
        description: getApiErrorMessage(err, 'Error'),
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">
              Employee Logins
            </h1>
            <p className="text-sm text-text-secondary">
              Portal passwords for employees with user accounts
            </p>
          </div>
        </div>

        {isSuperAdmin && (
          <Button
            className="bg-primary hover:bg-primary-dark"
            onClick={startBulkWhatsApp}
          >
            <MessageCircle className="mr-2 h-4 w-4" />
            WhatsApp portal credentials
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label>Project</Label>
          <Select
            value={projectId || 'all'}
            onValueChange={(v) => {
              setProjectId(v === 'all' ? '' : v)
              setBranchId('')
            }}
          >
            <SelectTrigger className="w-[220px]">
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
            <SelectTrigger className="w-[260px]">
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
      </div>

      <TableRecordCount count={total} label="login account" />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Biometric ID</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Password</TableHead>
                <TableHead>Last Updated</TableHead>
                <TableHead className="w-[200px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(9)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : paginated.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="text-center text-text-secondary"
                  >
                    No employee login accounts found
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>
                      <EmployeeNameLink employee={record.user.employee} />
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {record.user.employee?.employeeCode ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {record.user.employee?.biometricId ?? '—'}
                    </TableCell>
                    <TableCell>
                      {record.user.branch
                        ? formatBranchLabel(record.user.branch)
                        : '—'}
                    </TableCell>
                    <TableCell>{record.user.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {record.user.role.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">
                          {visiblePasswords[record.id]
                            ? record.plainText
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
                    </TableCell>
                    <TableCell>
                      {format(new Date(record.updatedAt), 'dd/MM/yyyy HH:mm')}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {isSuperAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => sendOneWhatsApp(record)}
                          >
                            <MessageCircle className="mr-1 h-3.5 w-3.5" />
                            WA
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setResetRecord(record)}
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          Reset
                        </Button>
                      </div>
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

      <ResetPasswordDialog
        record={resetRecord}
        open={!!resetRecord}
        onOpenChange={(open) => !open && setResetRecord(null)}
      />

      <PortalCredentialsWhatsAppDialog
        open={waOpen}
        onOpenChange={setWaOpen}
        data={waShares}
        isLoading={waLoading || (!!waError && !waShares)}
      />
    </div>
  )
}
