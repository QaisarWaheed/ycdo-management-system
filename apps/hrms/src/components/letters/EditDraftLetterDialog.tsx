import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { lettersApi } from '@/api/endpoints/letters'
import { UrduLetterCanvas } from '@/components/letters/UrduLetterCanvas'
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
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import {
  printDraftBlockedReason,
  SAVE_BEFORE_PRINT_MESSAGE,
} from '@/lib/appointmentProofread'
import {
  getLetterExtraFields,
  isUrduLetterType,
  letterReference,
} from '@/lib/letterFieldConfig'
import type { Letter, LetterType } from '@/types'

function toInputDate(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (match) return `${match[3]}-${match[2]}-${match[1]}`
  return value
}

function stringifyField(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join('\n')
  }
  return String(value)
}

function fieldsFromLetter(letter: Letter): Record<string, string> {
  const source = {
    ...((letter.variables as Record<string, unknown> | null) ?? {}),
    ...((letter.content as Record<string, unknown> | null) ?? {}),
  }
  const extraFields = getLetterExtraFields(letter.letterType as LetterType)
  const next: Record<string, string> = {}
  for (const field of extraFields) {
    const raw = source[field.key]
    next[field.key] =
      field.type === 'date' ? toInputDate(raw) : stringifyField(raw)
  }
  return next
}

export function EditDraftLetterDialog({
  letter,
  open,
  onOpenChange,
  initialPreviewHtml,
  canApprove = false,
  onLetterUpdated,
}: {
  letter: Letter | null
  open: boolean
  onOpenChange: (open: boolean) => void
  initialPreviewHtml?: string | null
  canApprove?: boolean
  onLetterUpdated?: (letter: Letter) => void
}) {
  const queryClient = useQueryClient()
  const [current, setCurrent] = useState<Letter | null>(letter)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [savedFieldsJson, setSavedFieldsJson] = useState('')
  const [pane, setPane] = useState<'edit' | 'preview'>('preview')
  const [savedHtml, setSavedHtml] = useState<string | null>(null)
  const [printBusy, setPrintBusy] = useState(false)

  const active = current ?? letter
  const letterType = (active?.letterType ?? 'WARNING') as LetterType
  const isAppointment = letterType === 'APPOINTMENT'
  const extraFields = useMemo(
    () => getLetterExtraFields(letterType),
    [letterType],
  )
  const urduMode = isUrduLetterType(letterType)
  const templateFields = extraFields.filter((f) => f.onTemplate)
  const sideFields = extraFields.filter((f) => !f.onTemplate)
  const status = active?.status
  const canEdit = status === 'DRAFT'
  const dirty =
    canEdit && savedFieldsJson !== '' && JSON.stringify(fields) !== savedFieldsJson
  const printBlock = printDraftBlockedReason(dirty)

  useEffect(() => {
    if (!open || !letter) return
    setCurrent(letter)
    const nextFields = fieldsFromLetter(letter)
    setFields(nextFields)
    setSavedFieldsJson(JSON.stringify(nextFields))
    setSavedHtml(initialPreviewHtml ?? null)
    setPane(isAppointment ? 'preview' : 'edit')
  }, [open, letter, initialPreviewHtml, isAppointment])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['letters'] })
    queryClient.invalidateQueries({ queryKey: ['letters-pending'] })
    queryClient.invalidateQueries({
      queryKey: ['letters', 'appointment-approvals'],
    })
  }

  const buildExtraFieldsPayload = () => {
    const payload: Record<string, string> = {}
    for (const field of extraFields) {
      const value = fields[field.key] ?? ''
      if (field.type === 'date' && value.trim()) {
        try {
          payload[field.key] = format(parseISO(value), 'dd/MM/yyyy')
        } catch {
          payload[field.key] = value
        }
      } else {
        payload[field.key] = value
      }
    }
    return payload
  }

  const mutation = useMutation({
    mutationFn: () =>
      lettersApi.update(active!.id, {
        extraFields: buildExtraFieldsPayload(),
      }),
    onSuccess: (data) => {
      if (data.letter.letterType !== 'APPOINTMENT') {
        toast({
          title: 'Draft letter updated',
          description: `${letterReference(data.letter)} remains a draft until you send it`,
        })
        invalidate()
        onOpenChange(false)
        return
      }
      const nextFields = fieldsFromLetter(data.letter)
      setCurrent(data.letter)
      setFields(nextFields)
      setSavedFieldsJson(JSON.stringify(nextFields))
      setSavedHtml(data.previewHtml)
      setPane('preview')
      onLetterUpdated?.(data.letter)
      toast({
        title: 'Draft saved',
        description: 'Showing the saved watermarked preview. Print uses this version.',
      })
      invalidate()
    },
    onError: (err: {
      response?: { data?: { message?: string | string[] } }
    }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Could not save draft',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const submitMutation = useMutation({
    mutationFn: () => lettersApi.submitForApproval(active!.id),
    onSuccess: (data) => {
      setCurrent(data.letter)
      onLetterUpdated?.(data.letter)
      setPane('preview')
      toast({
        title: 'Submitted for approval',
        description: 'Watermark stays on until Send.',
      })
      invalidate()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Submit failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const approveMutation = useMutation({
    mutationFn: () => lettersApi.approve(active!.id),
    onSuccess: (data) => {
      setCurrent(data.letter)
      onLetterUpdated?.(data.letter)
      toast({ title: 'Approved', description: 'HR can Send the final letter.' })
      invalidate()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Approve failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const rejectMutation = useMutation({
    mutationFn: () => lettersApi.reject(active!.id),
    onSuccess: (data) => {
      setCurrent(data.letter)
      onLetterUpdated?.(data.letter)
      setPane('edit')
      toast({ title: 'Returned to draft' })
      invalidate()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Return failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const sendMutation = useMutation({
    mutationFn: () => lettersApi.send(active!.id),
    onSuccess: (data) => {
      setCurrent(data.letter)
      onLetterUpdated?.(data.letter)
      toast({
        title: data.alreadySent ? 'Already sent' : 'Appointment letter sent',
        description: data.alreadySent
          ? data.message
          : 'Final PDF has no draft watermark.',
      })
      invalidate()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Send failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const showSavedPreview = () => {
    if (printBlock) {
      toast({ title: SAVE_BEFORE_PRINT_MESSAGE, variant: 'destructive' })
      return
    }
    setPane('preview')
  }

  const printSavedDraft = async () => {
    if (!active) return
    if (printBlock) {
      toast({ title: SAVE_BEFORE_PRINT_MESSAGE, variant: 'destructive' })
      return
    }
    setPrintBusy(true)
    try {
      const { downloadLetterPdf } = await import('@/lib/downloadLetterPdf')
      await downloadLetterPdf(active.id, `${letterReference(active)}.pdf`)
    } catch (err) {
      toast({
        title: 'Could not print draft',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setPrintBusy(false)
    }
  }

  if (!active) return null

  const appointmentActions = isAppointment ? (
    <div className="flex flex-wrap justify-end gap-2">
      {canEdit ? (
        <>
          <Button
            variant="outline"
            type="button"
            onClick={() => setPane('edit')}
          >
            Edit
          </Button>
          <Button
            type="button"
            className="bg-primary hover:bg-primary-dark"
            disabled={mutation.isPending || !dirty}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving…' : 'Save / Update'}
          </Button>
        </>
      ) : null}
      <Button variant="outline" type="button" onClick={showSavedPreview}>
        {status === 'SENT' ? 'Preview' : 'Preview'}
      </Button>
      <Button
        variant="outline"
        type="button"
        disabled={!!printBlock || printBusy}
        title={printBlock ?? undefined}
        onClick={() => void printSavedDraft()}
      >
        {status === 'SENT' ? 'Download / Print Final' : 'Print Draft'}
      </Button>
      {status === 'DRAFT' ? (
        <Button
          type="button"
          disabled={!!printBlock || submitMutation.isPending || dirty}
          title={dirty ? SAVE_BEFORE_PRINT_MESSAGE : undefined}
          onClick={() => submitMutation.mutate()}
        >
          Submit for Approval
        </Button>
      ) : null}
      {canApprove && status === 'PENDING_APPROVAL' ? (
        <>
          <Button
            type="button"
            disabled={approveMutation.isPending}
            onClick={() => approveMutation.mutate()}
          >
            Approve
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={rejectMutation.isPending}
            onClick={() => rejectMutation.mutate()}
          >
            Return
          </Button>
        </>
      ) : null}
      {status === 'APPROVED' ? (
        <>
          {canApprove ? (
            <Button
              variant="outline"
              type="button"
              disabled={rejectMutation.isPending}
              onClick={() => rejectMutation.mutate()}
            >
              Return
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={sendMutation.isPending}
            onClick={() => sendMutation.mutate()}
          >
            Send
          </Button>
        </>
      ) : null}
      <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
        Close
      </Button>
    </div>
  ) : (
    <>
      <Button variant="outline" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button
        className="bg-primary hover:bg-primary-dark"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? 'Saving…' : 'Save draft'}
      </Button>
    </>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {isAppointment
              ? `Appointment letter — ${letterReference(active)}${
                  status ? ` · ${status.replace(/_/g, ' ')}` : ''
                }`
              : `Edit draft — ${letterReference(active)}`}
          </DialogTitle>
        </DialogHeader>

        {isAppointment ? (
          <p className="text-sm text-text-secondary">
            Preview and Print Draft use the last saved file. Unsaved edits are
            not included until you Save / Update. Draft copies stay watermarked
            until Send.
          </p>
        ) : (
          <p className="text-sm text-text-secondary">
            Saving updates the draft only. It does not send the letter or change
            employee status.
          </p>
        )}

        {isAppointment && pane === 'preview' ? (
          savedHtml ? (
            <iframe
              title="Saved appointment preview"
              className="h-[60vh] w-full rounded border bg-white"
              srcDoc={savedHtml}
            />
          ) : (
            <p className="rounded border border-dashed p-6 text-sm text-text-secondary">
              Saved preview appears here after Save / Update. Print Draft still
              downloads the last saved PDF from the server.
            </p>
          )
        ) : canEdit ? (
          urduMode ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <UrduLetterCanvas
                letterType={letterType}
                fields={fields}
                onChange={(key, value) =>
                  setFields((f) => ({ ...f, [key]: value }))
                }
                templateFields={templateFields}
              />
              <div className="space-y-3">
                {sideFields.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <Label>{field.label}</Label>
                    {field.type === 'textarea' ? (
                      <Textarea
                        dir="rtl"
                        lang="ur"
                        value={fields[field.key] ?? ''}
                        onChange={(e) =>
                          setFields((f) => ({
                            ...f,
                            [field.key]: e.target.value,
                          }))
                        }
                      />
                    ) : (
                      <Input
                        dir={field.type === 'date' ? undefined : 'rtl'}
                        lang="ur"
                        type={
                          field.type === 'number'
                            ? 'number'
                            : field.type === 'date'
                              ? 'date'
                              : 'text'
                        }
                        step={field.step}
                        min={field.min}
                        max={field.max}
                        value={fields[field.key] ?? ''}
                        onChange={(e) =>
                          setFields((f) => ({
                            ...f,
                            [field.key]: e.target.value,
                          }))
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {extraFields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label>{field.label}</Label>
                  {field.type === 'textarea' ? (
                    <Textarea
                      value={fields[field.key] ?? ''}
                      onChange={(e) =>
                        setFields((f) => ({
                          ...f,
                          [field.key]: e.target.value,
                        }))
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
                      step={field.step}
                      min={field.min}
                      max={field.max}
                      value={fields[field.key] ?? ''}
                      onChange={(e) =>
                        setFields((f) => ({
                          ...f,
                          [field.key]: e.target.value,
                        }))
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          )
        ) : (
          <p className="text-sm text-text-secondary">
            Editing is locked for this status. Use Preview or Print Draft for the
            saved copy.
          </p>
        )}

        <DialogFooter className="sm:justify-end">{appointmentActions}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
