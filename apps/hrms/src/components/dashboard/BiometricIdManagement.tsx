import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Fingerprint } from 'lucide-react'
import { employeesApi } from '@/api/endpoints/employees'
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
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/hooks/use-toast'

export function BiometricIdManagement() {
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')

  const { data: stats, isLoading } = useQuery({
    queryKey: ['biometric-id-stats'],
    queryFn: () => employeesApi.getBiometricIdStats(),
  })

  const generateMutation = useMutation({
    mutationFn: () => employeesApi.generateBiometricIds(),
    onSuccess: (result) => {
      toast({
        title: `${result.total} biometric IDs generated successfully`,
        description: `Range: ${result.range}`,
      })
      setConfirmOpen(false)
      setConfirmation('')
      queryClient.invalidateQueries({ queryKey: ['biometric-id-stats'] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['it-admin-employees'] })
    },
    onError: (error: {
      response?: { data?: { message?: string | string[] } }
    }) => {
      const message = error.response?.data?.message
      toast({
        title: 'Failed to generate biometric IDs',
        description: Array.isArray(message)
          ? message.join(', ')
          : String(message ?? 'Please try again'),
        variant: 'destructive',
      })
    },
  })

  const openConfirmation = () => {
    setConfirmation('')
    setConfirmOpen(true)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Biometric ID Management</h2>
        <p className="text-sm text-text-secondary">
          Review assignment coverage or regenerate sequential IDs.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Employees with biometric ID
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <p className="text-3xl font-bold text-green-700">
                {stats?.assigned ?? 0}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Employees without biometric ID
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <p className="text-3xl font-bold text-amber-700">
                {stats?.unassigned ?? 0}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-red-200">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-start gap-3">
            <Fingerprint className="mt-0.5 h-5 w-5 text-red-700" />
            <div>
              <p className="font-medium">Regenerate all biometric IDs</p>
              <p className="text-sm text-text-secondary">
                Reassign every employee sequentially from 1.
              </p>
            </div>
          </div>
          <Button variant="destructive" onClick={openConfirmation}>
            Generate All Biometric IDs
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open)
          if (!open) setConfirmation('')
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Biometric IDs</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <p>
                This will NULL all existing biometric IDs for all{' '}
                {stats?.total ?? 0} employees and reassign sequential IDs
                starting from 1. This action cannot be undone. Biometric
                devices will need to be re-enrolled after this.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="biometric-confirm">
                Type CONFIRM to proceed
              </Label>
              <Input
                id="biometric-confirm"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                confirmation !== 'CONFIRM' || generateMutation.isPending
              }
              onClick={() => generateMutation.mutate()}
            >
              {generateMutation.isPending
                ? 'Generating...'
                : 'Generate All IDs'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
