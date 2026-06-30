import { useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  calculateDutyEndTime,
  dutyTimeOptions,
} from '@/lib/dutyTimes'

type DutyHoursFieldsProps = {
  totalHours: number | ''
  startTime: string
  endTime: string
  onTotalHoursChange: (value: number | '') => void
  onStartTimeChange: (value: string) => void
  onEndTimeChange: (value: string) => void
}

export function DutyHoursFields({
  totalHours,
  startTime,
  endTime,
  onTotalHoursChange,
  onStartTimeChange,
  onEndTimeChange,
}: DutyHoursFieldsProps) {
  useEffect(() => {
    if (startTime && totalHours !== '' && totalHours > 0) {
      onEndTimeChange(calculateDutyEndTime(startTime, totalHours))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime, totalHours])

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
          />
          <span className="text-sm text-text-secondary">hours/day</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-text-secondary">Working Hours</Label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs text-text-secondary">From</Label>
            <Select
              value={startTime || undefined}
              onValueChange={onStartTimeChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select start time" />
              </SelectTrigger>
              <SelectContent>
                {dutyTimeOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-text-secondary">To</Label>
            <Select value={endTime || undefined} onValueChange={onEndTimeChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select end time" />
              </SelectTrigger>
              <SelectContent>
                {dutyTimeOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  )
}
