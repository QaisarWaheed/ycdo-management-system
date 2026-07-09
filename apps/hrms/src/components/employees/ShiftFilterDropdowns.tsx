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
  formatShiftTime,
  getShiftsForStartTime,
  getUniqueShiftStartTimes,
} from '@/lib/shiftFilterUtils'
import { cn } from '@/lib/utils'
import type { Shift } from '@/types'

type ShiftFilterDropdownsProps = {
  shifts: Pick<Shift, 'id' | 'name' | 'startTime' | 'endTime'>[]
  shiftStartTime: string
  shiftId: string
  onShiftStartTimeChange: (startTime: string) => void
  onShiftIdChange: (shiftId: string) => void
  showSpecificShift?: boolean
  className?: string
  triggerClassName?: string
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
  const uniqueStartTimes = useMemo(
    () => getUniqueShiftStartTimes(shifts),
    [shifts],
  )

  const matchingShifts = useMemo(
    () => (shiftStartTime ? getShiftsForStartTime(shifts, shiftStartTime) : []),
    [shifts, shiftStartTime],
  )

  return (
    <div className={cn('flex flex-wrap gap-3', className)}>
      <div className="space-y-1">
        <Label>Check-in</Label>
        <Select
          value={shiftStartTime || 'all'}
          onValueChange={(v) => {
            onShiftStartTimeChange(v === 'all' ? '' : v)
          }}
        >
          <SelectTrigger className={triggerClassName}>
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

      {showSpecificShift && (
        <div className="space-y-1">
          <Label>Checkout</Label>
          <Select
            value={shiftId || ALL_SHIFTS_AT_START}
            onValueChange={onShiftIdChange}
            disabled={!shiftStartTime}
          >
            <SelectTrigger className={triggerClassName}>
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
                  {formatShiftTime(shift.endTime)} checkout
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}
