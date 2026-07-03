import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface EmployeeSearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function EmployeeSearchInput({
  value,
  onChange,
  placeholder = 'Search by name or code...',
  className,
}: EmployeeSearchInputProps) {
  return (
    <div className={`relative min-w-[220px] ${className ?? ''}`}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
      <Input
        placeholder={placeholder}
        className="pl-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
