import { useQuery } from '@tanstack/react-query'
import { lettersApi } from '@/api/endpoints/letters'

/**
 * Missing-checkout letters: payroll cuts 1 day per 3 incidents in the month,
 * so reversing one letter only returns money when it crosses a multiple of 3.
 */
export function ReverseImpactNote({ letterId }: { letterId: string }) {
  const { data } = useQuery({
    queryKey: ['letters', 'reverse-impact', letterId],
    queryFn: () => lettersApi.reverseImpact(letterId),
  })
  if (!data) return null
  const returned = data.daysBefore > data.daysAfter
  return (
    <p
      className={`rounded-md border p-2 text-sm ${
        returned ? 'border-green-300 bg-green-50 text-green-900' : 'border-amber-300 bg-amber-50 text-amber-900'
      }`}
    >
      Missing checkouts in {data.month}: {data.incidentsBefore} now (deduction {data.daysBefore} day
      {data.daysBefore === 1 ? '' : 's'}), {data.incidentsAfter} after reversing (deduction {data.daysAfter} day
      {data.daysAfter === 1 ? '' : 's'}).{' '}
      {returned
        ? 'Reversing returns one day of pay.'
        : 'The deduction does not change: it is 1 day per 3 missing checkouts in the month.'}
    </p>
  )
}
