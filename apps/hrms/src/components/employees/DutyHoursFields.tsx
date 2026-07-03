import { useMemo } from 'react'
import { SearchableSelect } from '@/components/common/SearchableSelect'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  dutyTimeOptions,
  getStartTimeOptionsForShift,
} from '@/lib/dutyTimes'

type DutyHoursFieldsProps = {
  shiftName?: string
  totalHours: number | ''
  startTime: string
  endTime: string
  onTotalHoursChange: (value: number | '') => void
  onStartTimeChange: (value: string) => void
  onEndTimeChange: (value: string) => void
}

function timeValueToLabel(value: string): string {
  if (value === '23:59') return '11:59 PM'
  return dutyTimeOptions.find((opt) => opt.value === value)?.label ?? value
}

function timeLabelToValue(label: string): string {
  if (label === '11:59 PM') return '23:59'
  return dutyTimeOptions.find((opt) => opt.label === label)?.value ?? label
}

export function DutyHoursFields({
  shiftName = '',
  totalHours,
  startTime,
  endTime,
  onTotalHoursChange,
  onStartTimeChange,
  onEndTimeChange,
}: DutyHoursFieldsProps) {
  const is24Hours = shiftName === '24 Hours' || totalHours === 24

  const startTimeOptions = useMemo(
    () => getStartTimeOptionsForShift(shiftName),
    [shiftName],
  )

  const startTimeLabels = useMemo(
    () => startTimeOptions.map((opt) => opt.label),
    [startTimeOptions],
  )

  const endTimeLabels = useMemo(
    () => dutyTimeOptions.map((opt) => opt.label),
    [],
  )

  return (
    <div className="space-y-4 sm:col-span-2">
      <Label className="text-sm font-medium">Duty Hours</Label>

      <div className="space-y-2">
        <Label className="text-text-secondary">Total Daily Hours</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={24}
            placeholder="e.g. 8"
            value={totalHours}
            onChange={(e) => {
              const val = e.target.value
              onTotalHoursChange(val === '' ? '' : Number(val))
            }}
            className="max-w-[120px]"
            disabled={is24Hours}
          />
          <span className="text-sm text-text-secondary">hours/day</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-text-secondary">Working Hours</Label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SearchableSelect
            label="From"
            options={startTimeLabels}
            value={timeValueToLabel(startTime)}
            onChange={(label) => onStartTimeChange(timeLabelToValue(label))}
            placeholder="Select start time"
            disabled={is24Hours}
          />
          <SearchableSelect
            label="To"
            options={endTimeLabels}
            value={timeValueToLabel(endTime)}
            onChange={(label) => onEndTimeChange(timeLabelToValue(label))}
            placeholder="Select end time"
            disabled={is24Hours}
          />
        </div>
        {is24Hours && (
          <p className="mt-1 text-sm text-blue-600">
            24-hour duty — working hours cover the full day
          </p>
        )}
      </div>
    </div>
  )
}
