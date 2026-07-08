import * as React from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type DateInputProps = Omit<
  React.ComponentProps<'input'>,
  'type' | 'value' | 'onChange'
> & {
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  error?: string
}

function sanitizeDateValue(val: string): string {
  if (!val) return ''
  const parts = val.split('-')
  if (parts[0] && parts[0].length > 4) {
    parts[0] = parts[0].slice(0, 4)
    return parts.filter(Boolean).join('-')
  }
  return val
}

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  (
    {
      value,
      onChange,
      min = '1900-01-01',
      max = '2099-12-31',
      disabled,
      placeholder,
      error,
      className,
      ...props
    },
    ref,
  ) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(sanitizeDateValue(e.target.value))
    }

    return (
      <div className="w-full">
        <Input
          ref={ref}
          type="date"
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          placeholder={placeholder}
          className={cn(error && 'border-destructive', className)}
          onChange={handleChange}
          {...props}
        />
        {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
      </div>
    )
  },
)

DateInput.displayName = 'DateInput'
