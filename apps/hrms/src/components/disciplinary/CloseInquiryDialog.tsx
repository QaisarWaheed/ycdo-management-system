import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { branchesApi } from '@/api/endpoints/branches'
import { disciplinaryApi } from '@/api/endpoints/disciplinary'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { getApiErrorMessage } from '@/lib/apiErrorMessage'
import type { Inquiry } from '@/types'

export function CloseInquiryDialog({
  inquiry,
  open,
  onOpenChange,
}: {
  inquiry: Inquiry | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [finding, setFinding] = useState<'GUILTY' | 'NOT_GUILTY'>('NOT_GUILTY')
  const [notesEn, setNotesEn] = useState('')
  const [notesUr, setNotesUr] = useState('')
  const [recommendation, setRecommendation] = useState('')
  const [finalAction, setFinalAction] = useState('FINE_AND_REINSTATE')
  const [destinationBranchId, setDestinationBranchId] = useState('')
  const [fineAmount, setFineAmount] = useState('')

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
    enabled: open,
  })

  useEffect(() => {
    if (!open || !inquiry) return
    setFinding(inquiry.finding ?? 'NOT_GUILTY')
    const existing = inquiry.notes ?? ''
    const enMatch = existing.match(/English:\s*([\s\S]*?)(?:\nUrdu:|$)/i)
    const urMatch = existing.match(/Urdu:\s*([\s\S]*)$/i)
    setNotesEn(enMatch?.[1]?.trim() || existing)
    setNotesUr(urMatch?.[1]?.trim() || '')
    setRecommendation(inquiry.closeRecommendation ?? '')
    setFinalAction(inquiry.finalAction ?? 'FINE_AND_REINSTATE')
    setDestinationBranchId(inquiry.destinationBranchId ?? '')
    setFineAmount(inquiry.fineAmount != null ? String(inquiry.fineAmount) : '')
  }, [open, inquiry])

  const combinedNotes = [
    notesEn.trim() ? `English:\n${notesEn.trim()}` : '',
    notesUr.trim() ? `Urdu:\n${notesUr.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const submitMutation = useMutation({
    mutationFn: () =>
      disciplinaryApi.closeInquiry(inquiry!.id, {
        finding,
        notes: combinedNotes,
        closeRecommendation: recommendation,
        destinationBranchId: destinationBranchId || undefined,
        finalAction: finding === 'GUILTY' ? finalAction : undefined,
        fineAmount:
          finding === 'GUILTY' && finalAction === 'FINE_AND_REINSTATE'
            ? Number(fineAmount)
            : undefined,
      }),
    onSuccess: () => {
      toast({
        title: 'Inquiry closed',
        description:
          'The inquiry officer’s result was recorded. If reinstated, the employee is ACTIVE now and late/UA counts restart from today.',
      })
      queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['suspension-watchlist'] })
      onOpenChange(false)
    },
    onError: (err: unknown) => {
      toast({
        title: 'Could not close inquiry',
        description: getApiErrorMessage(err, 'Request failed'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Close inquiry</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-text-secondary">
            The inquiry is physical / offline. Write what the inquiry officer or
            management decided. Closing applies the outcome immediately.
          </p>
          <div className="space-y-1">
            <Label>Finding</Label>
            <Select
              value={finding}
              onValueChange={(v) => setFinding(v as 'GUILTY' | 'NOT_GUILTY')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NOT_GUILTY">
                  Not guilty / first-time favor / reinstate without fine (Active)
                </SelectItem>
                <SelectItem value="GUILTY">Guilty — choose action below</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>What the inquiry officer said (English)</Label>
            <Textarea
              value={notesEn}
              onChange={(e) => setNotesEn(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-1">
            <Label>انکوائری آفیسر کا بیان (اردو)</Label>
            <Textarea
              dir="rtl"
              value={notesUr}
              onChange={(e) => setNotesUr(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-1">
            <Label>Recommendation / action note</Label>
            <Textarea
              value={recommendation}
              onChange={(e) => setRecommendation(e.target.value)}
              rows={2}
            />
          </div>
          {finding === 'GUILTY' && (
            <div className="space-y-1">
              <Label>Action (applied now)</Label>
              <Select value={finalAction} onValueChange={setFinalAction}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FINE_AND_REINSTATE">
                    Fine and reinstate (Active)
                  </SelectItem>
                  <SelectItem value="REST">On rest</SelectItem>
                  <SelectItem value="TERMINATE">Terminated</SelectItem>
                  <SelectItem value="DISMISS">Dismissed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label>Duty branch (optional — leave blank to keep current)</Label>
            <Select
              value={destinationBranchId || 'KEEP'}
              onValueChange={(value) =>
                setDestinationBranchId(value === 'KEEP' ? '' : value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Keep current branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="KEEP">Keep current branch</SelectItem>
                {branches.map((b: { id: string; name: string }) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {finding === 'GUILTY' && finalAction === 'FINE_AND_REINSTATE' && (
            <div className="space-y-1">
              <Label>Fine amount</Label>
              <Input
                type="number"
                min={1}
                value={fineAmount}
                onChange={(e) => setFineAmount(e.target.value)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={
              submitMutation.isPending ||
              (finding === 'GUILTY' &&
                finalAction === 'FINE_AND_REINSTATE' &&
                !(Number(fineAmount) > 0))
            }
            onClick={() => submitMutation.mutate()}
          >
            {submitMutation.isPending ? 'Closing…' : 'Close inquiry and apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
