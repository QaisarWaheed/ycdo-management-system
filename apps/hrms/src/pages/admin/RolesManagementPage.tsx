import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate } from 'react-router-dom'
import { Plus, ShieldCheck } from 'lucide-react'
import { branchesApi } from '@/api/endpoints/branches'
import { userAccessApi } from '@/api/endpoints/userAccess'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { formatRole, ROLE_GROUPS } from '@/lib/roleLabels'

export function RolesManagementPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
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

  const createMutation = useMutation({
    mutationFn: () =>
      userAccessApi.createSystemLogin({
        email,
        password,
        role,
        branchId: branchId || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'System login created' })
      setCreateOpen(false)
      setEmail('')
      setPassword('')
      setRole('')
      setBranchId('')
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

  if (user?.role !== 'IT_ADMIN' && user?.role !== 'SUPER_ADMIN') {
    return <Navigate to="/dashboard" replace />
  }

  const assignableRoles = meta?.assignableRoles ?? []
  const permissionLabels = meta?.permissionLabels ?? {}

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShieldCheck className="h-7 w-7 text-primary" />
            Roles & Access
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            IT has full control to assign any system role and manage permissions.
            Create HRMS logins for President, Founder, Chairman Admin, HR teams,
            and branch managers.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/admin/login-access">Open Login Access</Link>
          </Button>
          <Button
            className="bg-primary hover:bg-primary-dark"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            Create system login
          </Button>
        </div>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 text-sm">
          <p className="font-medium">IT full control</p>
          <p className="mt-1 text-text-secondary">
            You can assign all {assignableRoles.length} system roles, edit
            master data (districts, tehsils, police stations), manage org
            structure from the dashboard, and control every login from Login
            Access.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {ROLE_GROUPS.map((group) => (
          <Card key={group.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{group.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {group.roles.map((roleKey) => (
                <div
                  key={roleKey}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                >
                  <div>
                    <p className="font-medium">{formatRole(roleKey)}</p>
                    <p className="text-xs text-text-secondary">{roleKey}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRole(roleKey)
                      setCreateOpen(true)
                    }}
                  >
                    Assign
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Permission keys</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(permissionLabels).map(([key, label]) => (
              <Badge key={key} variant="outline" title={String(label)}>
                {key.replace(/_/g, ' ')}
              </Badge>
            ))}
          </div>
          <p className="mt-3 text-xs text-text-secondary">
            Override defaults per user in Login Access → Manage Access.
          </p>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create system login</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@ycdo.org"
              />
            </div>
            <div className="space-y-2">
              <Label>Password *</Label>
              <Input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Role *</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {formatRole(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Branch (optional)</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={
                !email.trim() || !password.trim() || !role || createMutation.isPending
              }
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Creating...' : 'Create login'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
