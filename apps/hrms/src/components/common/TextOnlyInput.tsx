import { forwardRef } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface TextOnlyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
}

function stripDigits(value: string) {
  return value.replace(/\d/g, '')
}

export const TextOnlyInput = forwardRef<HTMLInputElement, TextOnlyInputProps>(
  ({ onChange, onKeyDown, onPaste, className, ...props }, ref) => {
    return (
      <Input
        ref={ref}
        className={cn(className)}
        onKeyDown={(e) => {
          if (e.key.length === 1 && /\d/.test(e.key)) {
            e.preventDefault()
          }
          onKeyDown?.(e)
        }}
        onPaste={(e) => {
          e.preventDefault()
          const text = stripDigits(e.clipboardData.getData('text'))
          onChange?.({
            target: { value: text, name: props.name ?? '' },
          } as React.ChangeEvent<HTMLInputElement>)
        }}
        onChange={(e) => {
          onChange?.({
            ...e,
            target: { ...e.target, value: stripDigits(e.target.value) },
          })
        }}
        {...props}
      />
    )
  },
)

TextOnlyInput.displayName = 'TextOnlyInput'
