import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Timer,
  Trash2,
} from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { shiftsApi } from '@/api/endpoints/shifts'
import { TablePagination } from '@/components/common/TablePagination'
import { TableRecordCount } from '@/components/common/TableRecordCount'
import { TimeInput12Hour } from '@/components/common/TimeInput12Hour'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
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
import { usePagination } from '@/hooks/usePagination'
import { useAuth } from '@/hooks/useAuth'
import {
  checkInGroupLabel,
  groupShiftsByCheckIn,
} from '@/lib/shiftFilterUtils'
import { to12Hour } from '@/lib/timeFormat'
import { cn } from '@/lib/utils'
import type { Shift } from '@/types'

const SUPER_ADMIN_ROLES = ['SUPER_ADMIN'] as const

type DialogMode = 'new-checkin' | 'add-checkout' | 'edit'

function apiErrorMessage(err: unknown) {
  const msg = (err as { response?: { data?: { message?: string | string[] } } })
    .response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}

export function ShiftsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<DialogMode>('new-checkin')
  const [editShift, setEditShift] = useState<Shift | null>(null)
  const [presetStartTime, setPresetStartTime] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')

  const canManage =
    user?.role &&
    SUPER_ADMIN_ROLES.includes(user.role as (typeof SUPER_ADMIN_ROLES)[number])

  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => shiftsApi.getAll(),
    enabled: !!canManage,
  })

  const groups = useMemo(() => groupShiftsByCheckIn(shifts), [shifts])

  const { page, setPage, totalPages, paginated, total } = usePagination(
    groups,
    [shifts],
  )

  const resetForm = () => {
    setPresetStartTime('')
    setStartTime('')
    setEndTime('')
    setEditShift(null)
  }

  const openNewCheckIn = () => {
    resetForm()
    setStartTime('06:00')
    setEndTime('08:00')
    setDialogMode('new-checkin')
    setDialogOpen(true)
  }

  const openAddCheckout = (checkInTime: string) => {
    resetForm()
    setDialogMode('add-checkout')
    setPresetStartTime(checkInTime)
    setStartTime(checkInTime)
    setEndTime('12:00')
    setDialogOpen(true)
  }

  const openEdit = (shift: Shift) => {
    setEditShift(shift)
    setDialogMode('edit')
    setPresetStartTime(shift.startTime)
    setStartTime(shift.startTime)
    setEndTime(shift.endTime)
    setDialogOpen(true)
  }

  const toggleGroup = (checkInTime: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(checkInTime)) {
        next.delete(checkInTime)
      } else {
        next.add(checkInTime)
      }
      return next
    })
  }

  const createMutation = useMutation({
    mutationFn: () => shiftsApi.create({ startTime, endTime }),
    onSuccess: () => {
      toast({ title: 'Shift created' })
      resetForm()
      setDialogOpen(false)
      setExpandedGroups((prev) => new Set(prev).add(startTime))
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
      shiftsApi.update(editShift!.id, { startTime, endTime }),
    onSuccess: () => {
      toast({ title: 'Shift updated' })
      resetForm()
      setDialogOpen(false)
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

  const dialogTitle =
    dialogMode === 'new-checkin'
      ? 'Add Check-in Time'
      : dialogMode === 'add-checkout'
        ? `Add Checkout — ${to12Hour(presetStartTime)}`
        : 'Edit Shift'

  const shiftForm = (
    <div className="space-y-4">
      {dialogMode === 'add-checkout' ? (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-text-secondary">Check-in: </span>
          <span className="font-medium">{to12Hour(presetStartTime)}</span>
        </div>
      ) : (
        <div className="space-y-2">
          <Label>Check-in Time</Label>
          <TimeInput12Hour value={startTime} onChange={setStartTime} />
        </div>
      )}
      <div className="space-y-2">
        <Label>Checkout Time</Label>
        <TimeInput12Hour value={endTime} onChange={setEndTime} />
      </div>
      {dialogMode !== 'new-checkin' && (
        <p className="text-xs text-text-secondary">
          Multiple checkout times under the same check-in are grouped together.
        </p>
      )}
    </div>
  )

  const isSaving = createMutation.isPending || updateMutation.isPending
  const canSave =
    (dialogMode === 'add-checkout' ? !!presetStartTime : !!startTime) &&
    !!endTime &&
    !isSaving

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
            <Timer className="h-7 w-7 text-primary" />
            Shifts
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Shifts are grouped by check-in time. Each check-in can have multiple
            checkout times (e.g. 6:00 AM → 8:00 AM, 12:00 PM, 3:00 PM).
          </p>
        </div>
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={openNewCheckIn}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Check-in Time
        </Button>
      </div>

      <TableRecordCount count={total} label="shift group" />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Check-in / Checkout</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Employees</TableHead>
                <TableHead className="w-[140px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(4)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(5)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : paginated.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-text-secondary"
                  >
                    No shifts found
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((group) => {
                  const isExpanded = expandedGroups.has(group.startTime)
                  const groupName = group.variants[0]?.name ?? '—'

                  return (
                    <Fragment key={group.startTime}>
                      <TableRow
                        className="cursor-pointer bg-muted/30 hover:bg-muted/50"
                        onClick={() => toggleGroup(group.startTime)}
                      >
                        <TableCell>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-text-secondary" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-text-secondary" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {checkInGroupLabel(
                            group.startTime,
                            group.variants.length,
                          )}
                        </TableCell>
                        <TableCell>{groupName}</TableCell>
                        <TableCell>{group.totalEmployees}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openAddCheckout(group.startTime)}
                          >
                            <Plus className="mr-1 h-3 w-3" />
                            Checkout
                          </Button>
                        </TableCell>
                      </TableRow>

                      {isExpanded &&
                        group.variants.map((shift) => (
                          <TableRow key={shift.id} className="bg-background">
                            <TableCell />
                            <TableCell className="pl-10">
                              <span className="text-text-secondary">
                                {to12Hour(shift.startTime)}
                              </span>
                              <span className="mx-2 text-text-secondary">→</span>
                              <span className="font-medium">
                                {to12Hour(shift.endTime)}
                              </span>
                            </TableCell>
                            <TableCell className="text-text-secondary">
                              {shift.name}
                            </TableCell>
                            <TableCell>{shift._count?.employees ?? 0}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => openEdit(shift)}
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
                                        `Delete shift ${to12Hour(shift.startTime)} – ${to12Hour(shift.endTime)}?`,
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
                        ))}
                    </Fragment>
                  )
                })
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

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) resetForm()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          {shiftForm}
          <DialogFooter>
            <Button
              className={cn('bg-primary hover:bg-primary-dark')}
              disabled={!canSave}
              onClick={() => {
                if (dialogMode === 'edit') {
                  updateMutation.mutate()
                } else {
                  createMutation.mutate()
                }
              }}
            >
              {isSaving
                ? 'Saving...'
                : dialogMode === 'edit'
                  ? 'Save Changes'
                  : 'Create Shift'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
