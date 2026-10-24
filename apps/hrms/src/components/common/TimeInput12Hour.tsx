import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { from24Hour, to24Hour } from '@/lib/timeFormat'
import { cn } from '@/lib/utils'

type TimeInput12HourProps = {
  value: string
  onChange: (value24: string) => void
  disabled?: boolean
  className?: string
}

export function TimeInput12Hour({
  value,
  onChange,
  disabled,
  className,
}: TimeInput12HourProps) {
  // No value = empty boxes. Showing a default 12:00 AM looked like a real time,
  // and any touch then saved midnight as the check-in.
  const parsed = value ? from24Hour(value) : null
  const [hour, setHour] = useState<number | null>(parsed?.hour ?? null)
  const [minute, setMinute] = useState<number | null>(parsed?.minute ?? null)
  const [period, setPeriod] = useState<'AM' | 'PM'>(parsed?.period ?? 'AM')

  useEffect(() => {
    if (!value) {
      setHour(null)
      setMinute(null)
      return
    }
    const next = from24Hour(value)
    setHour(next.hour)
    setMinute(next.minute)
    setPeriod(next.period)
  }, [value])

  // Nothing is sent until an hour is entered.
  const emit = (h: number | null, m: number | null, p: 'AM' | 'PM') => {
    if (h === null) return
    onChange(to24Hour(h, m ?? 0, p))
  }

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Input
        type="number"
        min={1}
        max={12}
        placeholder="HH"
        className="w-14 px-2"
        disabled={disabled}
        value={hour ?? ''}
        onChange={(e) => {
          if (e.target.value === '') return
          const h = Math.min(12, Math.max(1, Number(e.target.value) || 1))
          setHour(h)
          emit(h, minute, period)
        }}
      />
      <span className="text-text-secondary">:</span>
      <Input
        type="number"
        min={0}
        max={59}
        placeholder="MM"
        className="w-14 px-2"
        disabled={disabled}
        value={minute ?? ''}
        onChange={(e) => {
          const m = Math.min(59, Math.max(0, Number(e.target.value) || 0))
          setMinute(m)
          emit(hour, m, period)
        }}
      />
      <Select
        value={period}
        disabled={disabled}
        onValueChange={(v) => {
          const p = v as 'AM' | 'PM'
          setPeriod(p)
          emit(hour, minute, p)
        }}
      >
        <SelectTrigger className="w-[72px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
