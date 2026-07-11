import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Fingerprint, RefreshCw } from 'lucide-react'
import {
  faceSyncApi,
  type FaceSyncJob,
  type FaceSyncJobStatus,
} from '@/api/endpoints/faceSync'
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
import { cn } from '@/lib/utils'

const API_BASE = import.meta.env.VITE_API_URL || 'http://187.127.115.103:3000'

function resolveFileUrl(path?: string | null) {
  if (!path) return undefined
  if (path.startsWith('http')) return path
  return `${API_BASE}${path}`
}

const statusStyles: Record<FaceSyncJobStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
  SYNCED: 'bg-green-100 text-green-800 border-green-200',
  FAILED: 'bg-red-100 text-red-800 border-red-200',
  PARTIAL: 'bg-orange-100 text-orange-800 border-orange-200',
}

function StatusBadge({ status }: { status: FaceSyncJobStatus }) {
  return (
    <Badge variant="outline" className={cn(statusStyles[status])}>
      {status}
    </Badge>
  )
}

export function FaceSyncTab() {
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['face-sync', 'stats'],
    queryFn: () => faceSyncApi.getStats(),
  })

  const { data: jobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ['face-sync', 'jobs'],
    queryFn: () => faceSyncApi.listJobs(),
  })

  const { data: employeeCount = 0 } = useQuery({
    queryKey: ['face-sync', 'sync-all-preview'],
    queryFn: () => faceSyncApi.syncAllPreview(),
    enabled: confirmOpen,
  })

  const syncAllMutation = useMutation({
    mutationFn: () => faceSyncApi.syncAll(),
    onSuccess: (data) => {
      toast({
        title: 'Sync jobs created',
        description: data.message,
      })
      setConfirmOpen(false)
      queryClient.invalidateQueries({ queryKey: ['face-sync'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to create sync jobs',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const retryMutation = useMutation({
    mutationFn: (employeeId: string) => faceSyncApi.syncEmployee(employeeId),
    onSuccess: () => {
      toast({ title: 'Retry job created' })
      queryClient.invalidateQueries({ queryKey: ['face-sync'] })
    },
    onError: () => {
      toast({ title: 'Failed to retry sync', variant: 'destructive' })
    },
  })

  const statCards = [
    { label: 'Total Jobs', value: stats?.total ?? 0 },
    { label: 'Synced', value: stats?.synced ?? 0 },
    { label: 'Pending', value: stats?.pending ?? 0 },
    { label: 'Failed', value: stats?.failed ?? 0 },
    { label: 'Partial', value: stats?.partial ?? 0 },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          Push employee photos to branch Hikvision biometric devices via branch
          agents.
        </p>
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => setConfirmOpen(true)}
        >
          <Fingerprint className="mr-2 h-4 w-4" />
          Sync All Employees
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {statCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="p-4">
              {statsLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                <p className="text-2xl font-bold">{card.value}</p>
              )}
              <p className="text-xs text-text-secondary">{card.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Photo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Results</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobsLoading ? (
                [...Array(4)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(6)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : jobs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-text-secondary"
                  >
                    No face sync jobs yet
                  </TableCell>
                </TableRow>
              ) : (
                (jobs as FaceSyncJob[]).map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{job.employee.fullName}</p>
                        <p className="text-xs text-text-secondary">
                          {job.employee.employeeCode}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {resolveFileUrl(job.photoUrl) ? (
                        <img
                          src={resolveFileUrl(job.photoUrl)}
                          alt=""
                          className="h-10 w-10 rounded object-cover"
                        />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={job.status} />
                    </TableCell>
                    <TableCell className="text-sm text-text-secondary">
                      {format(new Date(job.createdAt), 'dd MMM yyyy HH:mm')}
                    </TableCell>
                    <TableCell className="text-sm">
                      {job.successCount}/{job.deviceCount} devices
                    </TableCell>
                    <TableCell>
                      {(job.status === 'FAILED' || job.status === 'PARTIAL') && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={retryMutation.isPending}
                          onClick={() => retryMutation.mutate(job.employeeId)}
                        >
                          <RefreshCw className="mr-1 h-3.5 w-3.5" />
                          Retry
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sync All Employees</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">
            Create face sync jobs for all active employees with photos? This
            will queue {employeeCount} employees for sync.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={syncAllMutation.isPending}
              onClick={() => syncAllMutation.mutate()}
            >
              {syncAllMutation.isPending ? 'Creating...' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function FaceSyncStatusBadge({
  status,
}: {
  status?: FaceSyncJobStatus | null
}) {
  if (!status) {
    return (
      <Badge variant="outline" className="bg-slate-100 text-slate-600">
        Not Synced
      </Badge>
    )
  }

  const labels: Record<FaceSyncJobStatus, string> = {
    SYNCED: 'Face Synced ✓',
    PENDING: 'Sync Pending...',
    FAILED: 'Sync Failed',
    PARTIAL: 'Partially Synced',
  }

  return (
    <Badge variant="outline" className={cn('text-xs', statusStyles[status])}>
      {labels[status]}
    </Badge>
  )
}
