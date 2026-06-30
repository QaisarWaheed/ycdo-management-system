import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Bell, Plus } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { broadcastsApi } from '@/api/endpoints/broadcasts'
import { employeesApi } from '@/api/endpoints/employees'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
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
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import {
  BROADCAST_TARGETS,
  type BroadcastTarget,
  type NotificationBroadcast,
} from '@/types'

function SendBroadcastDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [targetRole, setTargetRole] = useState<BroadcastTarget>('ALL')

  const { data: employees = [] } = useQuery({
    queryKey: ['employees-all'],
    queryFn: () => employeesApi.getAll({}),
    enabled: open && targetRole === 'ALL',
  })

  const estimateCount =
    targetRole === 'ALL' ? employees.length : 'Selected role users'

  const mutation = useMutation({
    mutationFn: () =>
      broadcastsApi.create({ title, message, targetRole }),
    onSuccess: (data) => {
      toast({
        title: `Broadcast sent to ${data.notificationCount ?? 'target'} recipients`,
      })
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] })
      setTitle('')
      setMessage('')
      setTargetRole('ALL')
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to send broadcast',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send Broadcast</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Message * ({message.length}/5000)</Label>
            <Textarea
              value={message}
              maxLength={5000}
              rows={5}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Target Audience *</Label>
            <Select
              value={targetRole}
              onValueChange={(v) => setTargetRole(v as BroadcastTarget)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BROADCAST_TARGETS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="p-3 text-sm text-blue-900">
              Estimated recipients:{' '}
              <strong>{estimateCount}</strong>
            </CardContent>
          </Card>
        </div>
        <DialogFooter>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={!title || !message || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Sending...' : 'Send Broadcast'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function BroadcastsPage() {
  const { user } = useAuth()

  if (user?.role !== 'IT_ADMIN') {
    return <Navigate to="/dashboard" replace />
  }

  return <BroadcastsPageContent />
}

function BroadcastsPageContent() {
  const queryClient = useQueryClient()
  const [sendOpen, setSendOpen] = useState(false)
  const [deactivateId, setDeactivateId] = useState<string | null>(null)

  const { data: broadcasts = [], isLoading } = useQuery({
    queryKey: ['broadcasts'],
    queryFn: () => broadcastsApi.getAll(),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => broadcastsApi.deactivate(id),
    onSuccess: () => {
      toast({ title: 'Broadcast deactivated' })
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] })
      setDeactivateId(null)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to deactivate',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const targetLabel = (role: string) =>
    BROADCAST_TARGETS.find((t) => t.value === role)?.label ?? role

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold text-text-primary">
            Notifications & Broadcasts
          </h1>
        </div>
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => setSendOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Send Broadcast
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Sent By</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(7)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : broadcasts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-text-secondary">
                  No broadcasts yet
                </TableCell>
              </TableRow>
            ) : (
              (broadcasts as NotificationBroadcast[]).map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.title}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-text-secondary">
                    {b.message}
                  </TableCell>
                  <TableCell>{targetLabel(b.targetRole)}</TableCell>
                  <TableCell>{b.createdBy?.email ?? '—'}</TableCell>
                  <TableCell>
                    {format(new Date(b.createdAt), 'dd/MM/yyyy HH:mm')}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        b.isActive
                          ? 'border-green-200 bg-green-50 text-green-800'
                          : 'border-gray-200 text-gray-500'
                      }
                    >
                      {b.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {b.isActive && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setDeactivateId(b.id)}
                      >
                        Deactivate
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <SendBroadcastDialog open={sendOpen} onOpenChange={setSendOpen} />

      <ConfirmDialog
        open={!!deactivateId}
        title="Deactivate Broadcast"
        description="This will mark the broadcast as inactive."
        confirmLabel="Deactivate"
        confirmVariant="destructive"
        loading={deactivateMutation.isPending}
        onConfirm={() => deactivateId && deactivateMutation.mutate(deactivateId)}
        onCancel={() => setDeactivateId(null)}
      />
    </div>
  )
}
