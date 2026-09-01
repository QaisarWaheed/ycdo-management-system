import { formatWeeklyOffWeekdays, toggleWeeklyOffDay, WEEKDAY_OFF_OPTIONS } from '@/lib/weeklyOffDays'

export function WeeklyOffDaysChecklist({
  value,
  onChange,
}: {
  value: number[]
  onChange: (days: number[]) => void
}) {
  return (
    <fieldset className="space-y-2 sm:col-span-2">
      <legend className="text-sm font-medium">Weekly off days</legend>
      <p className="text-xs text-text-secondary">
        Paid rest. Leave all unchecked if they work every day. Attendance will
        not auto-mark unmarked on ticked weekdays.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {WEEKDAY_OFF_OPTIONS.map((day) => (
          <label
            key={day.value}
            className="flex items-center gap-1.5 text-sm"
          >
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={value.includes(day.value)}
              onChange={() => onChange(toggleWeeklyOffDay(value, day.value))}
            />
            {day.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export { formatWeeklyOffWeekdays }
