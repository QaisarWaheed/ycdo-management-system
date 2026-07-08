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
  const parsed = value ? from24Hour(value) : { hour: 12, minute: 0, period: 'AM' as const }
  const [hour, setHour] = useState(parsed.hour)
  const [minute, setMinute] = useState(parsed.minute)
  const [period, setPeriod] = useState<'AM' | 'PM'>(parsed.period)

  useEffect(() => {
    if (!value) return
    const next = from24Hour(value)
    setHour(next.hour)
    setMinute(next.minute)
    setPeriod(next.period)
  }, [value])

  const emit = (h: number, m: number, p: 'AM' | 'PM') => {
    onChange(to24Hour(h, m, p))
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
        value={hour}
        onChange={(e) => {
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
        value={minute}
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
