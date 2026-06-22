import { format } from 'date-fns'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface MonthYearValue {
  month: number
  year: number
}

interface MonthYearPickerProps {
  value: MonthYearValue
  onChange: (value: MonthYearValue) => void
  className?: string
}

const currentYear = new Date().getFullYear()
const years = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i)

export function MonthYearPicker({
  value,
  onChange,
  className,
}: MonthYearPickerProps) {
  return (
    <div className={className}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-text-secondary">Month</Label>
          <Select
            value={String(value.month)}
            onValueChange={(m) => onChange({ ...value, month: Number(m) })}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {format(new Date(2000, m - 1, 1), 'MMMM')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-text-secondary">Year</Label>
          <Select
            value={String(value.year)}
            onValueChange={(y) => onChange({ ...value, year: Number(y) })}
          >
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
