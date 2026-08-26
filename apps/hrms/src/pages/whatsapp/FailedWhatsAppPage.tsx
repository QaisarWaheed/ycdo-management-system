import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { whatsappApi } from '@/api/endpoints/whatsapp'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'

export function FailedWhatsAppPage({
  embedded = false,
}: {
  embedded?: boolean
}) {
  const queryClient = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['whatsapp-letter-sends-failed'],
    queryFn: () => whatsappApi.getFailedLetterSends(),
  })

  const resendMutation = useMutation({
    mutationFn: (id: string) => whatsappApi.resend(id),
    onSuccess: (row) => {
      if (row.status === 'SENT') {
        toast({ title: 'WhatsApp resent successfully' })
      } else {
        toast({
          title: 'Resend failed',
          description: row.error ?? 'Unknown error',
          variant: 'destructive',
        })
      }
      queryClient.invalidateQueries({ queryKey: ['whatsapp-letter-sends-failed'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Resend failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-4 p-6'}>
      {!embedded ? (
        <div>
          <h1 className="text-xl font-semibold text-text-primary">
            Failed WhatsApp
          </h1>
          <p className="text-sm text-text-secondary">
            Letter PDFs that failed Meta WhatsApp delivery. Resend after fixing
            phone, template, or Meta config.
          </p>
        </div>
      ) : (
        <p className="text-sm text-text-secondary">
          Letter PDFs that failed Meta WhatsApp delivery. Resend after fixing
          phone, template, or Meta config.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Letter</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Error</TableHead>
              <TableHead>Last tried</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(4)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(7)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-text-secondary">
                  No failed WhatsApp letter sends
                </TableCell>
              </TableRow>
            ) : (
              data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <EmployeeNameLink employee={row.employee} />
                    <p className="font-mono text-xs text-text-secondary">
                      {row.employee.employeeCode}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p>{row.letter.letterType.replace(/_/g, ' ')}</p>
                    {row.letter.letterNo && (
                      <p className="text-xs text-text-secondary">
                        {row.letter.letterNo}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {row.phoneE164}
                  </TableCell>
                  <TableCell className="max-w-[280px] text-sm text-destructive">
                    {row.error ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-text-secondary">
                    {row.lastTriedAt
                      ? format(new Date(row.lastTriedAt), 'dd/MM/yyyy HH:mm')
                      : '—'}
                  </TableCell>
                  <TableCell>{row.attempts}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      className="bg-primary hover:bg-primary-dark"
                      disabled={resendMutation.isPending}
                      onClick={() => resendMutation.mutate(row.id)}
                    >
                      Resend
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
