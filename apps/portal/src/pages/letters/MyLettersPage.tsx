import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { differenceInHours, format } from 'date-fns'
import { AlertTriangle, CheckCircle2, Download, MessageSquare } from 'lucide-react'
import { acknowledgementsApi } from '@/api/endpoints/acknowledgements'
import { employeesApi } from '@/api/endpoints/employees'
import { lettersApi } from '@/api/endpoints/letters'
import { letterRepliesApi } from '@/api/endpoints/letterReplies'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { letterReference, letterTypeBadgeClass } from '@/lib/helpers'
import { cn } from '@/lib/utils'
import type { Letter } from '@/types'

function ReplyStatusCell({ letter }: { letter: Letter }) {
  if (letter.letterType !== 'SHOW_CAUSE') {
    return <span className="text-text-secondary">—</span>
  }

  if (letter.isReplied) {
    return (
      <Badge variant="outline" className="border-green-200 bg-green-50 text-green-800">
        Replied
      </Badge>
    )
  }

  const deadline = letter.replyDeadline ? new Date(letter.replyDeadline) : null
  const now = new Date()

  if (deadline && deadline < now) {
    return (
      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-800">
        Overdue
      </Badge>
    )
  }

  if (deadline) {
    const hrs = Math.max(0, differenceInHours(deadline, now))
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
        Awaiting · {hrs} hrs left
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
      Awaiting
    </Badge>
  )
}

function AcknowledgementStatusCell({
  letter,
  pendingIds,
}: {
  letter: Letter
  pendingIds: Set<string>
}) {
  if (!letter.requiresAcknowledgement) {
    return <span className="text-text-secondary">—</span>
  }

  if (pendingIds.has(letter.id)) {
    return (
      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-800">
        Pending
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="border-green-200 bg-green-50 text-green-800">
      <CheckCircle2 className="mr-1 h-3 w-3" />
      Acknowledged
    </Badge>
  )
}

function LetterSummaryCard({ letter }: { letter: Letter }) {
  const content = letter.content ?? {}
  const entries = Object.entries(content).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  )

  return (
    <Card className="border-border bg-surface">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={letterTypeBadgeClass(letter.letterType)}
          >
            {letter.letterType.replace(/_/g, ' ')}
          </Badge>
          <span className="font-mono text-sm">{letterReference(letter)}</span>
        </div>
        <p className="text-sm text-text-secondary">
          Issued on {format(new Date(letter.generatedAt), 'dd MMMM yyyy')}
        </p>
        {entries.length > 0 && (
          <dl className="space-y-2 text-sm">
            {entries.map(([key, value]) => (
              <div key={key}>
                <dt className="font-medium capitalize text-text-primary">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </dt>
                <dd className="text-text-secondary">{String(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

function AcknowledgeDialog({
  letter,
  open,
  onOpenChange,
  employeeName,
}: {
  letter: Letter | null
  open: boolean
  onOpenChange: (open: boolean) => void
  employeeName: string
}) {
  const queryClient = useQueryClient()
  const [confirmed, setConfirmed] = useState(false)

  const mutation = useMutation({
    mutationFn: () => acknowledgementsApi.acknowledge({ letterId: letter!.id }),
    onSuccess: () => {
      toast({ title: 'Letter acknowledged successfully' })
      queryClient.invalidateQueries({ queryKey: ['my-letters'] })
      queryClient.invalidateQueries({ queryKey: ['pending-acknowledgements'] })
      setConfirmed(false)
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to acknowledge letter',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  if (!letter) return null

  const refNumber = letterReference(letter)
  const letterTypeLabel = letter.letterType.replace(/_/g, ' ')

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setConfirmed(false)
        onOpenChange(v)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Acknowledge Receipt — {letterTypeLabel} — {refNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            By acknowledging this letter, you confirm that you have read and
            understood its contents. This action is recorded and cannot be
            undone.
          </p>
        </div>

        <LetterSummaryCard letter={letter} />

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          <span className="text-sm leading-snug">
            I, <strong>{employeeName}</strong>, hereby acknowledge that I have
            read and understood the contents of this letter.
          </span>
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={!confirmed || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Submitting...' : 'Acknowledge Receipt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReplyDialog({
  letter,
  open,
  onOpenChange,
}: {
  letter: Letter | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [replyText, setReplyText] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      letterRepliesApi.reply({ letterId: letter!.id, replyText }),
    onSuccess: () => {
      toast({ title: 'Reply submitted successfully' })
      queryClient.invalidateQueries({ queryKey: ['my-letters'] })
      setReplyText('')
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to submit reply',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  if (!letter) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reply to Show Cause Notice</DialogTitle>
        </DialogHeader>

        {letter.autoEscalated && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            This letter was auto-escalated due to no reply within the deadline.
          </div>
        )}

        <div className="space-y-2 text-sm">
          <p>
            <span className="text-text-secondary">Reference: </span>
            {letterReference(letter)}
          </p>
          {letter.replyDeadline && (
            <p>
              <span className="text-text-secondary">Deadline: </span>
              {format(new Date(letter.replyDeadline), 'dd/MM/yyyy HH:mm')}
            </p>
          )}
        </div>

        <Textarea
          placeholder="Enter your reply..."
          rows={6}
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={!replyText.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Submitting...' : 'Submit Reply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function MyLettersPage() {
  const { user } = useAuth()
  const [replyLetter, setReplyLetter] = useState<Letter | null>(null)
  const [ackLetter, setAckLetter] = useState<Letter | null>(null)

  const { data: employee } = useQuery({
    queryKey: ['employee-letters', user?.employeeId],
    queryFn: () => employeesApi.getOne(user!.employeeId!),
    enabled: !!user?.employeeId,
  })

  const { data: letters = [], isLoading } = useQuery({
    queryKey: ['my-letters'],
    queryFn: () => lettersApi.getMy(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  })

  const { data: pendingAcks = [] } = useQuery({
    queryKey: ['pending-acknowledgements'],
    queryFn: () => acknowledgementsApi.getPending(),
    enabled: !!user?.employeeId,
    staleTime: 0,
    refetchOnWindowFocus: true,
  })

  const pendingIds = useMemo(
    () => new Set((pendingAcks as Letter[]).map((l) => l.id)),
    [pendingAcks],
  )

  const pendingCount = pendingAcks.length

  const employeeName = employee
    ? `${employee.firstName} ${employee.lastName}`
    : user?.email ?? 'Employee'

  const handleDownload = async (letter: Letter) => {
    try {
      const blob = await lettersApi.getPdf(letter.id)
      const url = URL.createObjectURL(blob as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${letterReference(letter)}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      await lettersApi.markPrinted(letter.id)
    } catch {
      toast({
        title: 'Failed to download letter',
        variant: 'destructive',
      })
    }
  }

  const sorted = [...(letters as Letter[])].sort(
    (a, b) =>
      new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">My Letters</h1>
        <p className="text-sm text-text-secondary">
          View official letters and respond to show cause notices
        </p>
      </div>

      {pendingCount > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          You have {pendingCount} letter{pendingCount !== 1 ? 's' : ''}{' '}
          requiring acknowledgement
        </div>
      )}

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Reply Status</TableHead>
              <TableHead>Acknowledgement</TableHead>
              <TableHead className="w-[160px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(4)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(6)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-text-secondary"
                >
                  No letters found
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((letter) => (
                <TableRow
                  key={letter.id}
                  className={cn(
                    pendingIds.has(letter.id) && 'bg-red-50/50',
                  )}
                >
                  <TableCell className="font-mono text-sm">
                    {letterReference(letter)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={letterTypeBadgeClass(letter.letterType)}
                    >
                      {letter.letterType.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {format(new Date(letter.generatedAt), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell>
                    <ReplyStatusCell letter={letter} />
                  </TableCell>
                  <TableCell>
                    <AcknowledgementStatusCell
                      letter={letter}
                      pendingIds={pendingIds}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownload(letter)}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      {letter.letterType === 'SHOW_CAUSE' &&
                        !letter.isReplied && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setReplyLetter(letter)}
                          >
                            <MessageSquare className="h-4 w-4" />
                          </Button>
                        )}
                      {letter.requiresAcknowledgement &&
                        pendingIds.has(letter.id) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setAckLetter(letter)}
                          >
                            Acknowledge
                          </Button>
                        )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ReplyDialog
        letter={replyLetter}
        open={!!replyLetter}
        onOpenChange={(v) => !v && setReplyLetter(null)}
      />

      <AcknowledgeDialog
        letter={ackLetter}
        open={!!ackLetter}
        onOpenChange={(v) => !v && setAckLetter(null)}
        employeeName={employeeName}
      />
    </div>
  )
}
