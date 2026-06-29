import { forwardRef } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface PhoneInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value?: string
  onChange?: (value: string) => void
  error?: boolean
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value = '', onChange, error, className, ...props }, ref) => {
    return (
      <Input
        ref={ref}
        value={value}
        placeholder="03XXXXXXXXX"
        inputMode="numeric"
        maxLength={11}
        className={cn(error && 'border-destructive', className)}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 11)
          onChange?.(digits)
        }}
        {...props}
      />
    )
  },
)

PhoneInput.displayName = 'PhoneInput'

export function isValidPhone(value: string): boolean {
  return /^0\d{10}$/.test(value)
}
