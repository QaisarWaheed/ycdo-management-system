import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Timer, Trash2 } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { branchesApi } from '@/api/endpoints/branches'
import { shiftsApi } from '@/api/endpoints/shifts'
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
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import type { Shift } from '@/types'

const SUPER_ADMIN_ROLES = ['SUPER_ADMIN'] as const
const SHIFT_NAMES = ['Morning', 'Evening', 'Night', '24 Hours'] as const

function apiErrorMessage(err: {
  response?: { data?: { message?: string | string[] } }
}) {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}

export function ShiftsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [branchFilter, setBranchFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editShift, setEditShift] = useState<Shift | null>(null)
  const [branchId, setBranchId] = useState('')
  const [name, setName] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')

  const canManage =
    user?.role &&
    SUPER_ADMIN_ROLES.includes(user.role as (typeof SUPER_ADMIN_ROLES)[number])

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
    enabled: !!canManage,
  })

  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ['shifts', branchFilter || 'all'],
    queryFn: () => shiftsApi.getAll(branchFilter || undefined),
    enabled: !!canManage,
  })

  const resetForm = () => {
    setBranchId('')
    setName('')
    setStartTime('')
    setEndTime('')
  }

  const createMutation = useMutation({
    mutationFn: () =>
      shiftsApi.create({ branchId, name, startTime, endTime }),
    onSuccess: () => {
      toast({ title: 'Shift created' })
      resetForm()
      setCreateOpen(false)
      queryClient.invalidateQueries({ queryKey: ['shifts'] })
    },
    onError: (err) => {
      toast({
        title: 'Failed to create shift',
        description: apiErrorMessage(err),
        variant: 'destructive',
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      shiftsApi.update(editShift!.id, { name, startTime, endTime }),
    onSuccess: () => {
      toast({ title: 'Shift updated' })
      setEditShift(null)
      resetForm()
      queryClient.invalidateQueries({ queryKey: ['shifts'] })
    },
    onError: (err) => {
      toast({
        title: 'Failed to update shift',
        description: apiErrorMessage(err),
        variant: 'destructive',
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => shiftsApi.delete(id),
    onSuccess: () => {
      toast({ title: 'Shift deleted' })
      queryClient.invalidateQueries({ queryKey: ['shifts'] })
    },
    onError: (err) => {
      toast({
        title: 'Failed to delete shift',
        description: apiErrorMessage(err),
        variant: 'destructive',
      })
    },
  })

  if (!canManage) {
    return <Navigate to="/dashboard" replace />
  }

  const shiftForm = (
    <div className="space-y-4">
      {!editShift && (
        <div className="space-y-2">
          <Label>Branch</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger>
              <SelectValue placeholder="Select branch" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {formatBranchLabel(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        <Label>Shift Name</Label>
        <Select value={name} onValueChange={setName}>
          <SelectTrigger>
            <SelectValue placeholder="Select shift" />
          </SelectTrigger>
          <SelectContent>
            {SHIFT_NAMES.map((shiftName) => (
              <SelectItem key={shiftName} value={shiftName}>
                {shiftName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Start Time (HH:MM)</Label>
          <Input
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            placeholder="09:00"
          />
        </div>
        <div className="space-y-2">
          <Label>End Time (HH:MM)</Label>
          <Input
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            placeholder="17:00"
          />
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
            <Timer className="h-7 w-7 text-primary" />
            Shifts
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Add, update, and delete branch shifts.
          </p>
        </div>
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Shift
        </Button>
      </div>

      <div className="space-y-1">
        <Label>Filter by Branch</Label>
        <Select
          value={branchFilter || 'all'}
          onValueChange={(v) => setBranchFilter(v === 'all' ? '' : v)}
        >
          <SelectTrigger className="w-full max-w-xs">
            <SelectValue placeholder="All branches" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All branches</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {formatBranchLabel(b)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Employees</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(4)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(6)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : shifts.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-text-secondary"
                  >
                    No shifts found
                  </TableCell>
                </TableRow>
              ) : (
                shifts.map((shift) => (
                  <TableRow key={shift.id}>
                    <TableCell className="font-medium">{shift.name}</TableCell>
                    <TableCell>{formatBranchLabel(shift.branch)}</TableCell>
                    <TableCell>{shift.startTime}</TableCell>
                    <TableCell>{shift.endTime}</TableCell>
                    <TableCell>{shift._count?.employees ?? 0}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditShift(shift)
                            setName(shift.name)
                            setStartTime(shift.startTime)
                            setEndTime(shift.endTime)
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={deleteMutation.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete shift "${shift.name}" at ${formatBranchLabel(shift.branch)}?`,
                              )
                            ) {
                              deleteMutation.mutate(shift.id)
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Shift</DialogTitle>
          </DialogHeader>
          {shiftForm}
          <DialogFooter>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={
                !branchId ||
                !name ||
                !startTime ||
                !endTime ||
                createMutation.isPending
              }
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Shift'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editShift}
        onOpenChange={(open) => {
          if (!open) {
            setEditShift(null)
            resetForm()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Shift</DialogTitle>
          </DialogHeader>
          {shiftForm}
          <DialogFooter>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={
                !name || !startTime || !endTime || updateMutation.isPending
              }
              onClick={() => updateMutation.mutate()}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
