import { forwardRef } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const CNIC_PATTERN = /^\d{5}-\d{7}-\d{1}$/

export function formatCnicInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 13)
  if (digits.length <= 5) return digits
  if (digits.length <= 12) {
    return `${digits.slice(0, 5)}-${digits.slice(5)}`
  }
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`
}

export function isValidCnic(value: string): boolean {
  return CNIC_PATTERN.test(value)
}

interface CnicInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value?: string
  onChange?: (value: string) => void
  error?: boolean
}

export const CnicInput = forwardRef<HTMLInputElement, CnicInputProps>(
  ({ value = '', onChange, error, className, ...props }, ref) => {
    return (
      <Input
        ref={ref}
        value={value}
        placeholder="12345-1234567-1"
        inputMode="numeric"
        className={cn(error && 'border-destructive', className)}
        onChange={(e) => onChange?.(formatCnicInput(e.target.value))}
        {...props}
      />
    )
  },
)

CnicInput.displayName = 'CnicInput'
