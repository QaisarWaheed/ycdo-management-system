import * as React from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface DateInputProps {
  value: string
  onChange: (value: string) => void
  label?: string
  required?: boolean
  error?: string
  disabled?: boolean
  className?: string
  compact?: boolean
  onBlur?: () => void
}

function parseYMD(value: string) {
  if (!value) return { day: '', month: '', year: '' }
  const [year, month, day] = value.split('-')
  return {
    day: day ?? '',
    month: month ?? '',
    year: year ?? '',
  }
}

function toYMD(day: string, month: string, year: string): string {
  if (day.length !== 2 || month.length !== 2 || year.length !== 4) return ''
  const d = Number(day)
  const m = Number(month)
  const y = Number(year)
  if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > 2099) return ''
  return `${year}-${month}-${day}`
}

function digitsOnly(value: string, maxLen: number) {
  return value.replace(/\D/g, '').slice(0, maxLen)
}

export const DateInput = React.forwardRef<HTMLDivElement, DateInputProps>(
  (
    { value, onChange, label, required, error, disabled, className, compact, onBlur },
    ref,
  ) => {
    const parsed = parseYMD(value)
    const [day, setDay] = React.useState(parsed.day)
    const [month, setMonth] = React.useState(parsed.month)
    const [year, setYear] = React.useState(parsed.year)

    React.useEffect(() => {
      const next = parseYMD(value)
      setDay(next.day)
      setMonth(next.month)
      setYear(next.year)
    }, [value])

    const emitChange = (d: string, m: string, y: string) => {
      const ymd = toYMD(d, m, y)
      if (ymd) {
        onChange(ymd)
        return
      }
      if (!d && !m && !y) {
        onChange('')
      }
    }

    const handleDay = (raw: string) => {
      const next = digitsOnly(raw, 2)
      setDay(next)
      emitChange(next, month, year)
    }

    const handleMonth = (raw: string) => {
      const next = digitsOnly(raw, 2)
      setMonth(next)
      emitChange(day, next, year)
    }

    const handleYear = (raw: string) => {
      const next = digitsOnly(raw, 4)
      setYear(next)
      emitChange(day, month, next)
    }

    return (
      <div ref={ref} className={cn(compact ? 'w-fit max-w-full' : 'w-full', className)}>
        {label && (
          <Label className="mb-2 block">
            {label}
            {required && <span className="text-destructive"> *</span>}
          </Label>
        )}
        <div className={cn('flex flex-nowrap items-center', compact ? 'gap-1' : 'gap-2')}>
          <Input
            inputMode="numeric"
            placeholder="DD"
            maxLength={2}
            value={day}
            disabled={disabled}
            className={cn(
              'shrink-0 text-center',
              compact ? 'h-9 w-10 px-1 text-sm' : 'w-16',
              error && 'border-destructive',
            )}
            onChange={(e) => handleDay(e.target.value)}
          />
          <span className="shrink-0 text-text-secondary">/</span>
          <Input
            inputMode="numeric"
            placeholder="MM"
            maxLength={2}
            value={month}
            disabled={disabled}
            className={cn(
              'shrink-0 text-center',
              compact ? 'h-9 w-10 px-1 text-sm' : 'w-16',
              error && 'border-destructive',
            )}
            onChange={(e) => handleMonth(e.target.value)}
          />
          <span className="shrink-0 text-text-secondary">/</span>
          <Input
            inputMode="numeric"
            placeholder="YYYY"
            maxLength={4}
            value={year}
            disabled={disabled}
            className={cn(
              'shrink-0 text-center',
              compact ? 'h-9 w-[4.25rem] px-1 text-sm' : 'w-24',
              error && 'border-destructive',
            )}
            onChange={(e) => handleYear(e.target.value)}
            onBlur={onBlur}
          />
        </div>
        {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
      </div>
    )
  },
)

DateInput.displayName = 'DateInput'
