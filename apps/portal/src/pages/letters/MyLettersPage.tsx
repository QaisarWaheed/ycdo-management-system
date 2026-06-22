import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { differenceInHours, format } from 'date-fns'
import { Download, MessageSquare } from 'lucide-react'
import { lettersApi } from '@/api/endpoints/letters'
import { letterRepliesApi } from '@/api/endpoints/letterReplies'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { letterReference, letterTypeBadgeClass } from '@/lib/helpers'
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
      queryClient.invalidateQueries({ queryKey: ['letters'] })
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
  const [replyLetter, setReplyLetter] = useState<Letter | null>(null)

  const { data: letters = [], isLoading } = useQuery({
    queryKey: ['letters'],
    queryFn: () => lettersApi.getMy(),
  })

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

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Reply Status</TableHead>
              <TableHead className="w-[140px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(4)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(5)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-text-secondary"
                >
                  No letters found
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((letter) => (
                <TableRow key={letter.id}>
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
    </div>
  )
}
