import { useMemo } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ALL_SHIFTS_AT_START,
  allShiftsAtStartLabel,
  formatShiftOptionLabel,
  formatShiftTime,
  getShiftsForStartTime,
  getUniqueShiftStartTimes,
} from '@/lib/shiftFilterUtils'
import { cn } from '@/lib/utils'
import type { Shift } from '@/types'

type ShiftFilterBaseProps = {
  shifts: Pick<Shift, 'id' | 'name' | 'startTime' | 'endTime'>[]
  shiftStartTime: string
  shiftId: string
  onShiftStartTimeChange: (startTime: string) => void
  onShiftIdChange: (shiftId: string) => void
  triggerClassName?: string
}

export function ShiftStartFilter({
  shifts,
  shiftStartTime,
  onShiftStartTimeChange,
  triggerClassName,
}: ShiftFilterBaseProps) {
  const uniqueStartTimes = useMemo(
    () => getUniqueShiftStartTimes(shifts),
    [shifts],
  )

  return (
    <div className="min-w-0 space-y-1">
      <Label>Shift Start</Label>
      <Select
        value={shiftStartTime || 'all'}
        onValueChange={(v) => {
          onShiftStartTimeChange(v === 'all' ? '' : v)
        }}
      >
        <SelectTrigger className={cn('w-full', triggerClassName)}>
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {uniqueStartTimes.map((startTime) => (
            <SelectItem key={startTime} value={startTime}>
              {formatShiftTime(startTime)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function SpecificShiftFilter({
  shifts,
  shiftStartTime,
  shiftId,
  onShiftIdChange,
  triggerClassName,
}: ShiftFilterBaseProps) {
  const matchingShifts = useMemo(
    () => (shiftStartTime ? getShiftsForStartTime(shifts, shiftStartTime) : []),
    [shifts, shiftStartTime],
  )

  return (
    <div className="min-w-0 space-y-1">
      <Label>Specific Shift</Label>
      <Select
        value={shiftId || ALL_SHIFTS_AT_START}
        onValueChange={onShiftIdChange}
        disabled={!shiftStartTime}
      >
        <SelectTrigger className={cn('w-full', triggerClassName)}>
          <SelectValue placeholder="Select shift" />
        </SelectTrigger>
        <SelectContent>
          {shiftStartTime && (
            <SelectItem value={ALL_SHIFTS_AT_START}>
              {allShiftsAtStartLabel(shiftStartTime)}
            </SelectItem>
          )}
          {matchingShifts.map((shift) => (
            <SelectItem key={shift.id} value={shift.id}>
              {formatShiftOptionLabel(shift)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

type ShiftFilterDropdownsProps = ShiftFilterBaseProps & {
  showSpecificShift?: boolean
  className?: string
}

export function ShiftFilterDropdowns({
  shifts,
  shiftStartTime,
  shiftId,
  onShiftStartTimeChange,
  onShiftIdChange,
  showSpecificShift = true,
  className,
  triggerClassName,
}: ShiftFilterDropdownsProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-3 sm:grid-cols-2',
        className,
      )}
    >
      <ShiftStartFilter
        shifts={shifts}
        shiftStartTime={shiftStartTime}
        shiftId={shiftId}
        onShiftStartTimeChange={onShiftStartTimeChange}
        onShiftIdChange={onShiftIdChange}
        triggerClassName={triggerClassName}
      />
      {showSpecificShift && (
        <SpecificShiftFilter
          shifts={shifts}
          shiftStartTime={shiftStartTime}
          shiftId={shiftId}
          onShiftStartTimeChange={onShiftStartTimeChange}
          onShiftIdChange={onShiftIdChange}
          triggerClassName={triggerClassName}
        />
      )}
    </div>
  )
}
