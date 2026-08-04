import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { employeesApi } from '@/api/endpoints/employees'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import {
  getLetterExtraFields,
  getLetterRequiredFields,
  isUrduLetterType,
  letterReference,
} from '@/lib/letterFieldConfig'
import { LETTER_TYPES, type LetterType } from '@/types'

interface GenerateLetterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  employeeId: string
}

export function GenerateLetterDialog({
  open,
  onOpenChange,
  employeeId,
}: GenerateLetterDialogProps) {
  const queryClient = useQueryClient()
  const [letterType, setLetterType] = useState<LetterType>('WARNING')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)

  const extraFields = getLetterExtraFields(letterType)
  const requiredFields = getLetterRequiredFields(letterType)
  const urduMode = isUrduLetterType(letterType)
  const templateFields = useMemo(
    () => extraFields.filter((f) => f.onTemplate),
    [extraFields],
  )
  const sideFields = useMemo(
    () => extraFields.filter((f) => !f.onTemplate),
    [extraFields],
  )

  const { data: employee } = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => employeesApi.getOne(employeeId),
    enabled: open && !!employeeId,
  })

  // Prefill identity from profile when opening / switching type (Urdu letters).
  useEffect(() => {
    if (!open || !employee || !urduMode) return
    setFields((prev) => ({
      ...prev,
      senderTitle: prev.senderTitle || 'کوآرڈینیٹر پروجیکٹس',
      employeeName: prev.employeeName || employee.fullName || '',
      designation: prev.designation || employee.currentDesignation || '',
      branch: prev.branch || employee.currentBranch?.name || '',
    }))
  }, [open, employee, urduMode, letterType])

  const buildExtraFieldsPayload = () => {
    const payload: Record<string, string> = {}
    for (const field of extraFields) {
      const value = fields[field.key]?.trim()
      if (!value) continue
      payload[field.key] =
        field.type === 'date' ? format(parseISO(value), 'dd/MM/yyyy') : value
    }
    return payload
  }

  const requiredFieldsFilled = requiredFields.every(
    (field) => (fields[field.key] ?? '').trim().length > 0,
  )

  const previewMutation = useMutation({
    mutationFn: () =>
      lettersApi.preview({
        employeeId,
        letterType,
        extraFields: buildExtraFieldsPayload(),
      }),
    onSuccess: (data) => setPreviewHtml(data.previewHtml),
    onError: (err: {
      response?: { data?: { message?: string | string[] } }
    }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Preview failed',
        description: Array.isArray(msg)
          ? msg.join(', ')
          : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  // Live Urdu preview while typing on the template
  useEffect(() => {
    if (!open || !urduMode || !requiredFieldsFilled) return
    const t = window.setTimeout(() => {
      previewMutation.mutate()
    }, 500)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, letterType, open, urduMode, requiredFieldsFilled])

  const mutation = useMutation({
    mutationFn: () =>
      lettersApi.generate({
        employeeId,
        letterType,
        extraFields: buildExtraFieldsPayload(),
      }),
    onSuccess: async (data) => {
      const ref = letterReference(data.letter)
      toast({
        title: 'Letter generated successfully',
        description: `Reference: ${ref}`,
      })
      queryClient.invalidateQueries({ queryKey: ['letters', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['letters'] })
      onOpenChange(false)
      setFields({})
      setPreviewHtml(null)
      if (data?.letter?.id) {
        try {
          const { downloadLetterPdf } = await import('@/lib/downloadLetterPdf')
          await downloadLetterPdf(
            data.letter.id,
            `${letterReference(data.letter)}.pdf`,
          )
        } catch (err) {
          toast({
            title: 'File unavailable — please reissue',
            description: err instanceof Error ? err.message : undefined,
            variant: 'destructive',
          })
        }
      }
    },
    onError: (err: {
      response?: { data?: { message?: string | string[] } }
    }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to generate letter',
        description: Array.isArray(msg)
          ? msg.join(', ')
          : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const setField = (key: string, value: string) => {
    setPreviewHtml(null)
    setFields((f) => ({ ...f, [key]: value }))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) {
          setFields({})
          setPreviewHtml(null)
        }
      }}
    >
      <DialogContent className="max-h-[95vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {urduMode ? 'اردو خط تیار کریں / Generate Urdu Letter' : 'Generate Letter'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Letter Type</Label>
            <Select
              value={letterType}
              onValueChange={(v) => {
                setLetterType(v as LetterType)
                setFields({})
                setPreviewHtml(null)
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LETTER_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {urduMode ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              خط کا اصل ٹیمپلیٹ نیچے دکھایا گیا ہے۔ نام، عہدہ، وجہ اور خلاف ورزیاں{' '}
              <strong>اردو</strong> میں ٹائپ کریں۔ دائیں جانب حقیقی پیش منظر نظر آئے گا۔
            </p>
          ) : (
            <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              This letter type uses the approved English format. Preview before
              issuing.
            </p>
          )}

          <div
            className={
              urduMode
                ? 'grid gap-4 lg:grid-cols-2'
                : 'space-y-4'
            }
          >
            {urduMode ? (
              <UrduLetterCanvas
                letterType={letterType}
                fields={fields}
                onChange={setField}
                templateFields={templateFields}
              />
            ) : null}

            <div className="space-y-3">
              {(urduMode ? sideFields : extraFields).map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label>{field.label}</Label>
                  {field.type === 'textarea' ? (
                    <Textarea
                      dir={urduMode ? 'rtl' : undefined}
                      lang={urduMode ? 'ur' : undefined}
                      value={fields[field.key] ?? ''}
                      onChange={(e) => setField(field.key, e.target.value)}
                    />
                  ) : (
                    <Input
                      dir={urduMode && field.type !== 'date' ? 'rtl' : undefined}
                      lang={urduMode ? 'ur' : undefined}
                      type={
                        field.type === 'number'
                          ? 'number'
                          : field.type === 'date'
                            ? 'date'
                            : 'text'
                      }
                      value={fields[field.key] ?? ''}
                      onChange={(e) => setField(field.key, e.target.value)}
                    />
                  )}
                  {field.hint ? (
                    <p className="text-xs text-text-secondary">{field.hint}</p>
                  ) : null}
                </div>
              ))}

              {previewHtml ? (
                <div className="space-y-1">
                  <Label>اصل خط کا پیش منظر / Live preview</Label>
                  <iframe
                    title="Letter preview"
                    className="h-[55vh] w-full rounded border bg-white"
                    srcDoc={previewHtml}
                  />
                </div>
              ) : urduMode ? (
                <div className="flex h-40 items-center justify-center rounded border border-dashed text-sm text-text-secondary">
                  ٹیمپلیٹ بھریں — پیش منظر خود لوڈ ہوگا
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {!urduMode && (
            <Button
              variant="outline"
              disabled={previewMutation.isPending || !requiredFieldsFilled}
              onClick={() => previewMutation.mutate()}
            >
              {previewMutation.isPending ? 'Rendering...' : 'Preview'}
            </Button>
          )}
          <Button
            className="bg-primary hover:bg-primary-dark"
            onClick={() => mutation.mutate()}
            disabled={
              mutation.isPending || !requiredFieldsFilled || !previewHtml
            }
          >
            {mutation.isPending ? 'Generating...' : 'Issue Letter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
