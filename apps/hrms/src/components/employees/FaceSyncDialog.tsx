import { useMutation } from '@tanstack/react-query'
import { Fingerprint } from 'lucide-react'
import { faceSyncApi } from '@/api/endpoints/faceSync'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { biometricDevicesApi } from '@/api/endpoints/biometricDevices'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'

interface FaceSyncDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  employeeId: string
  employeeName: string
  photoUrl?: string | null
  lastSyncedAt?: string | null
  onSuccess?: () => void
}

export function FaceSyncDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  photoUrl,
  lastSyncedAt,
  onSuccess,
}: FaceSyncDialogProps) {
  const { data: devices = [] } = useQuery({
    queryKey: ['biometric-devices'],
    queryFn: () => biometricDevicesApi.getAll(),
    enabled: open,
  })

  const syncMutation = useMutation({
    mutationFn: () => faceSyncApi.syncEmployee(employeeId),
    onSuccess: () => {
      toast({
        title: 'Sync job created',
        description:
          'Branch agents will sync within 60 seconds.',
      })
      onOpenChange(false)
      onSuccess?.()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to create sync job',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sync Face to All Branch Devices</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {photoUrl && (
            <div className="flex justify-center">
              <img
                src={photoUrl}
                alt={employeeName}
                className="h-32 w-32 rounded-lg border object-cover"
              />
            </div>
          )}

          <p className="text-sm text-text-secondary">
            {lastSyncedAt
              ? `Last synced: ${format(new Date(lastSyncedAt), 'dd MMM yyyy, HH:mm')}`
              : 'Never synced'}
          </p>

          <p className="text-sm">
            This will push {employeeName}&apos;s face to all{' '}
            {devices.length || 19} branch biometric devices. Branch agents must
            be running for sync to complete.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={syncMutation.isPending}
            onClick={() => syncMutation.mutate()}
          >
            <Fingerprint className="mr-2 h-4 w-4" />
            {syncMutation.isPending ? 'Starting...' : 'Start Sync'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
