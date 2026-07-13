import { forwardRef, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { normalizeOrgName } from '@/lib/normalizeOrgName'

interface UppercaseInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  onChange?: (value: string) => void
}

/** Text input that uppercases on blur — avoids cursor jump while typing spaces. */
export const UppercaseInput = forwardRef<HTMLInputElement, UppercaseInputProps>(
  ({ onChange, onBlur, className, ...props }, ref) => {
    const handleBlur = useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        const normalized = normalizeOrgName(e.target.value)
        if (normalized !== e.target.value) {
          onChange?.(normalized)
        }
        onBlur?.(e)
      },
      [onChange, onBlur],
    )

    return (
      <Input
        ref={ref}
        className={cn(className)}
        onChange={(e) => onChange?.(e.target.value)}
        onBlur={handleBlur}
        {...props}
      />
    )
  },
)

UppercaseInput.displayName = 'UppercaseInput'
