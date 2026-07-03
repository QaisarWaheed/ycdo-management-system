import { SearchableSelect } from '@/components/common/SearchableSelect'
import { dutyTimeOptions } from '@/lib/dutyTimes'
import { formatTime } from '@/lib/timeFormat'

const TIME_LABELS = dutyTimeOptions.map((opt) => opt.label)

function timeValueToLabel(value: string): string {
  if (!value) return ''
  if (value === '23:59') return '11:59 PM'
  return dutyTimeOptions.find((opt) => opt.value === value)?.label ?? formatTime(value)
}

function timeLabelToValue(label: string): string {
  if (label === '11:59 PM') return '23:59'
  return dutyTimeOptions.find((opt) => opt.label === label)?.value ?? label
}

interface TimeAmpmSelectProps {
  value: string
  onChange: (value: string) => void
  label?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function TimeAmpmSelect({
  value,
  onChange,
  label,
  placeholder = 'Select time',
  disabled,
  className,
}: TimeAmpmSelectProps) {
  return (
    <SearchableSelect
      label={label}
      options={TIME_LABELS}
      value={timeValueToLabel(value)}
      onChange={(label) => onChange(timeLabelToValue(label))}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
    />
  )
}
