import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import api from '@/api/axios'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface Amendment {
  id: string
  at: string
  by: string
  type: string
  detail: string
}

/** Every salary change for the employee: date, what changed, who did it. */
export function SalaryAmendmentHistory({ employeeId }: { employeeId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['salary-history', employeeId],
    queryFn: () => api.get<unknown, Amendment[]>(`/payroll/stipend/history/${employeeId}`),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Salary amendment history</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[150px]">Date</TableHead>
              <TableHead className="w-[170px]">Change</TableHead>
              <TableHead>Details</TableHead>
              <TableHead className="w-[160px]">By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4}>Loading…</TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-text-secondary">
                  No salary changes recorded
                </TableCell>
              </TableRow>
            ) : (
              data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {format(new Date(row.at), 'dd MMM yyyy, h:mm a')}
                  </TableCell>
                  <TableCell className="font-medium">{row.type}</TableCell>
                  <TableCell className="text-sm">{row.detail || '—'}</TableCell>
                  <TableCell className="text-sm">{row.by}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
