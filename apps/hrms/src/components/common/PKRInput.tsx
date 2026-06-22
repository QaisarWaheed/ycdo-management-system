import { forwardRef, useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface PKRInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value?: number
  onChange?: (value: number) => void
}

function formatPKR(num: number) {
  if (!num && num !== 0) return ''
  return num.toLocaleString('en-PK')
}

function parsePKR(str: string) {
  const cleaned = str.replace(/,/g, '')
  const num = Number(cleaned)
  return Number.isNaN(num) ? 0 : num
}

export const PKRInput = forwardRef<HTMLInputElement, PKRInputProps>(
  ({ value = 0, onChange, className, onBlur, onFocus, ...props }, ref) => {
    const [display, setDisplay] = useState(formatPKR(value))
    const [focused, setFocused] = useState(false)

    useEffect(() => {
      if (!focused) setDisplay(formatPKR(value))
    }, [value, focused])

    return (
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary">
          PKR
        </span>
        <Input
          ref={ref}
          className={cn('pl-12', className)}
          value={focused ? display.replace(/,/g, '') : display}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d.]/g, '')
            setDisplay(raw)
            onChange?.(parsePKR(raw))
          }}
          onFocus={(e) => {
            setFocused(true)
            setDisplay(String(value || ''))
            onFocus?.(e)
          }}
          onBlur={(e) => {
            setFocused(false)
            const num = parsePKR(display)
            setDisplay(formatPKR(num))
            onChange?.(num)
            onBlur?.(e)
          }}
          {...props}
        />
      </div>
    )
  },
)
PKRInput.displayName = 'PKRInput'
