import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { differenceInHours, format, parseISO } from 'date-fns'
import {
  AlertTriangle,
  Award,
  Briefcase,
  Check,
  FileText,
  Gavel,
  HelpCircle,
  Mail,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Scale,
  Shield,
  TrendingUp,
  UserCheck,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import { lettersApi } from '@/api/endpoints/letters'
import { letterRepliesApi } from '@/api/endpoints/letterReplies'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmployeeSearchSelect } from '@/components/common/EmployeeSearchSelect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import {
  getLetterExtraFields,
  letterReference,
  letterTypeBadgeClass,
} from '@/lib/letterFieldConfig'
import { cn } from '@/lib/utils'
import { LETTER_TYPES, type Letter, type LetterReply, type LetterType } from '@/types'

const ALL = 'ALL'

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
        Awaiting · {hrs} hrs remaining
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
      Awaiting
    </Badge>
  )
}

function LetterRepliesDialog({
  letter,
  open,
  onOpenChange,
}: {
  letter: Letter | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: replies = [], isLoading } = useQuery({
    queryKey: ['letter-replies', letter?.id],
    queryFn: () => letterRepliesApi.getRepliesByLetter(letter!.id),
    enabled: !!letter && open,
  })

  if (!letter) return null

  const ref = letterReference(letter)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Replies — {ref}</DialogTitle>
        </DialogHeader>

        {letter.autoEscalated && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            This letter was auto-escalated due to no reply within 48 hours
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : replies.length === 0 ? (
          <p className="py-8 text-center text-text-secondary">No replies yet</p>
        ) : (
          <div className="space-y-4">
            {(replies as LetterReply[]).map((reply) => (
              <div
                key={reply.id}
                className="rounded-lg border border-border p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <p className="font-medium">
                    {reply.employee
                      ? `${reply.employee.firstName} ${reply.employee.lastName}`
                      : 'Employee'}
                    {reply.employee?.employeeCode && (
                      <span className="ml-2 font-mono text-xs text-text-secondary">
                        {reply.employee.employeeCode}
                      </span>
                    )}
                  </p>
                  <span className="text-xs text-text-secondary">
                    {format(new Date(reply.repliedAt), 'dd/MM/yyyy HH:mm')}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{reply.replyText}</p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

const LETTER_ICONS: Record<LetterType, React.ElementType> = {
  APPOINTMENT: Briefcase,
  WARNING: AlertTriangle,
  ADVICE: HelpCircle,
  DISCIPLINARY: Gavel,
  EXPLANATION: FileText,
  SHOW_CAUSE: Scale,
  FINE: Shield,
  INQUIRY: HelpCircle,
  APPRECIATION: Award,
  TRANSFER: RefreshCw,
  SUSPENSION: UserMinus,
  TERMINATION: UserMinus,
  REINSTATEMENT: UserCheck,
  REJOINING: UserPlus,
  SALARY_INCREMENT: TrendingUp,
  EXPERIENCE: Mail,
}

function GenerateLetterWizard({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1)
  const [employeeId, setEmployeeId] = useState('')
  const [letterType, setLetterType] = useState<LetterType>('APPOINTMENT')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [downloadPrompt, setDownloadPrompt] = useState<{
    id: string
    reference: string
  } | null>(null)

  const reset = () => {
    setStep(1)
    setEmployeeId('')
    setLetterType('APPOINTMENT')
    setFields({})
  }

  const extraFields = getLetterExtraFields(letterType)

  const buildExtraFieldsPayload = () => {
    const payload: Record<string, string> = {}

    for (const field of extraFields) {
      const value = fields[field.key]?.trim()
      if (!value) continue

      payload[field.key] =
        field.type === 'date'
          ? format(parseISO(value), 'dd/MM/yyyy')
          : value
    }

    return payload
  }

  const mutation = useMutation({
    mutationFn: () =>
      lettersApi.generate({
        employeeId,
        letterType,
        extraFields: buildExtraFieldsPayload(),
      }),
    onSuccess: (data) => {
      const ref = letterReference(data.letter)
      toast({
        title: 'Letter generated',
        description: `Reference: ${ref}`,
      })
      queryClient.invalidateQueries({ queryKey: ['letters'] })
      onOpenChange(false)
      reset()
      setDownloadPrompt({ id: data.letter.id, reference: ref })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to generate letter',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          onOpenChange(v)
          if (!v) reset()
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Generate Letter — Step {step} of 3
            </DialogTitle>
          </DialogHeader>

          {step === 1 && (
            <div className="space-y-4 py-2">
              <EmployeeSearchSelect
                label="Select Employee"
                value={employeeId}
                onChange={(id) => setEmployeeId(id)}
              />
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {LETTER_TYPES.map((t) => {
                const Icon = LETTER_ICONS[t.value]
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => {
                      setLetterType(t.value)
                      setFields({})
                    }}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors hover:bg-muted',
                      letterType === t.value &&
                        'border-primary bg-primary/5 ring-1 ring-primary',
                    )}
                  >
                    <Icon className="h-6 w-6 text-primary" />
                    <span className="text-xs font-medium">{t.label}</span>
                  </button>
                )
              })}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                {LETTER_TYPES.find((t) => t.value === letterType)?.label} — extra
                fields
              </p>
              {extraFields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label>{field.label}</Label>
                  {field.type === 'textarea' ? (
                    <Textarea
                      value={fields[field.key] ?? ''}
                      onChange={(e) =>
                        setFields((f) => ({ ...f, [field.key]: e.target.value }))
                      }
                    />
                  ) : (
                    <Input
                      type={
                        field.type === 'number'
                          ? 'number'
                          : field.type === 'date'
                            ? 'date'
                            : 'text'
                      }
                      value={fields[field.key] ?? ''}
                      onChange={(e) =>
                        setFields((f) => ({ ...f, [field.key]: e.target.value }))
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          <DialogFooter className="gap-2">
            {step > 1 && (
              <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            )}
            {step < 3 ? (
              <Button
                className="bg-primary hover:bg-primary-dark"
                disabled={step === 1 && !employeeId}
                onClick={() => setStep((s) => s + 1)}
              >
                Next
              </Button>
            ) : (
              <Button
                className="bg-primary hover:bg-primary-dark"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? 'Generating...' : 'Generate'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!downloadPrompt}
        title="Download PDF now?"
        description={`Letter ${downloadPrompt?.reference} is ready.`}
        confirmLabel="Yes, Download"
        onConfirm={async () => {
          if (downloadPrompt) {
            try {
              const blob = await lettersApi.getPdf(downloadPrompt.id)
              window.open(URL.createObjectURL(blob), '_blank')
            } catch {
              toast({ title: 'Failed to download PDF', variant: 'destructive' })
            }
          }
          setDownloadPrompt(null)
        }}
        onCancel={() => setDownloadPrompt(null)}
      />
    </>
  )
}

export function LettersPage() {
  const queryClient = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [letterType, setLetterType] = useState(ALL)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [generateOpen, setGenerateOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [repliesLetter, setRepliesLetter] = useState<Letter | null>(null)

  const filters = useMemo(
    () => ({
      employeeId: employeeId || undefined,
      letterType: letterType !== ALL ? letterType : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
    [employeeId, letterType, startDate, endDate],
  )

  const { data: letters = [], isLoading } = useQuery({
    queryKey: ['letters', filters],
    queryFn: () => lettersApi.getAll(filters),
  })

  const markPrintedMutation = useMutation({
    mutationFn: (id: string) => lettersApi.markPrinted(id),
    onSuccess: () => {
      toast({ title: 'Letter marked as printed' })
      queryClient.invalidateQueries({ queryKey: ['letters'] })
    },
    onError: () => {
      toast({ title: 'Failed to mark printed', variant: 'destructive' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => lettersApi.delete(id),
    onSuccess: () => {
      toast({ title: 'Letter deleted' })
      queryClient.invalidateQueries({ queryKey: ['letters'] })
      setDeleteId(null)
    },
    onError: () => {
      toast({ title: 'Failed to delete letter', variant: 'destructive' })
    },
  })

  const downloadPdf = async (id: string) => {
    try {
      const blob = await lettersApi.getPdf(id)
      window.open(URL.createObjectURL(blob), '_blank')
    } catch {
      toast({ title: 'Failed to download PDF', variant: 'destructive' })
    }
  }

  const clearFilters = () => {
    setEmployeeId('')
    setLetterType(ALL)
    setStartDate('')
    setEndDate('')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-text-primary">
          Letter Management
        </h1>
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => setGenerateOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Generate Letter
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-white p-4">
        <div className="min-w-[220px] flex-1">
          <EmployeeSearchSelect
            label="Employee"
            value={employeeId}
            onChange={setEmployeeId}
            placeholder="Filter by employee..."
          />
        </div>

        <div className="space-y-1">
          <Label>Letter Type</Label>
          <Select value={letterType} onValueChange={setLetterType}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Types</SelectItem>
              {LETTER_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>From</Label>
          <Input
            type="date"
            className="w-[150px]"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label>To</Label>
          <Input
            type="date"
            className="w-[150px]"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        <Button variant="outline" onClick={clearFilters}>
          Clear Filters
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Generated</TableHead>
              <TableHead>Printed</TableHead>
              <TableHead>Replies</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(7)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : letters.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-text-secondary">
                  No letters found
                </TableCell>
              </TableRow>
            ) : (
              (letters as Letter[]).map((letter) => (
                <TableRow key={letter.id}>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs">
                      {letterReference(letter)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium">
                        {letter.employee
                          ? `${letter.employee.firstName} ${letter.employee.lastName}`
                          : '—'}
                      </p>
                      <p className="font-mono text-xs text-text-secondary">
                        {letter.employee?.employeeCode ?? '—'}
                      </p>
                    </div>
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
                    {format(new Date(letter.generatedAt), 'dd/MM/yyyy HH:mm')}
                  </TableCell>
                  <TableCell>
                    {letter.printedAt ? (
                      <Check className="h-5 w-5 text-green-600" />
                    ) : (
                      <span className="text-text-secondary">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ReplyStatusCell letter={letter} />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => downloadPdf(letter.id)}
                        >
                          Download PDF
                        </DropdownMenuItem>
                        {letter.letterType === 'SHOW_CAUSE' && (
                          <DropdownMenuItem
                            onClick={() => setRepliesLetter(letter)}
                          >
                            View Replies
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          disabled={!!letter.printedAt}
                          onClick={() => markPrintedMutation.mutate(letter.id)}
                        >
                          Mark as Printed
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={() => setDeleteId(letter.id)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <GenerateLetterWizard
        open={generateOpen}
        onOpenChange={setGenerateOpen}
      />

      <LetterRepliesDialog
        letter={repliesLetter}
        open={!!repliesLetter}
        onOpenChange={(v) => !v && setRepliesLetter(null)}
      />

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Letter"
        description="Are you sure you want to delete this letter? This action cannot be undone."
        confirmLabel="Delete"
        confirmVariant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  )
}
