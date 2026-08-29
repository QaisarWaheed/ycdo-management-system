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
import {
  translateBranch,
  translateDesignation,
  transliterateName,
} from '@/lib/urduIdentity'
import { GENERATE_LETTER_TYPES, type Letter, type LetterType } from '@/types'

interface GenerateLetterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  employeeId: string
  onOpenAppointmentDraft?: (letter: Letter, previewHtml: string) => void
}

export function GenerateLetterDialog({
  open,
  onOpenChange,
  employeeId,
  onOpenAppointmentDraft,
}: GenerateLetterDialogProps) {
  const queryClient = useQueryClient()
  const [selectedValue, setSelectedValue] = useState<string>('WARNING')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)

  const { data: allTemplates = [] } = useQuery({
    queryKey: ['letter-templates', 'active'],
    queryFn: () => lettersApi.getTemplates(),
    enabled: open,
  })
  const customTemplates = useMemo(
    () => allTemplates.filter((t) => t.isCustom),
    [allTemplates],
  )

  const isCustomSelection = selectedValue.startsWith('custom:')
  const customCode = isCustomSelection ? selectedValue.slice('custom:'.length) : undefined
  const letterType: LetterType = isCustomSelection ? 'CUSTOM' : (selectedValue as LetterType)
  const selectedCustomTemplate = customTemplates.find((t) => t.code === customCode)
  const customFieldDefs = selectedCustomTemplate?.fieldsSchema ?? undefined

  const extraFields = getLetterExtraFields(letterType, customFieldDefs)
  const requiredFields = getLetterRequiredFields(letterType, customFieldDefs)
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

  // Prefill identity from profile when opening / switching type.
  useEffect(() => {
    if (!open || !employee) return
    if (letterType === 'TRANSFER') {
      setFields((prev) => ({
        ...prev,
        fromPosting:
          prev.fromPosting || employee.currentBranch?.name || '',
        targetDesignation:
          prev.targetDesignation || employee.currentDesignation || '',
        dutyTotalHours:
          prev.dutyTotalHours ||
          (employee.dutyTotalHours != null
            ? String(employee.dutyTotalHours)
            : ''),
        dutyStartTime: prev.dutyStartTime || employee.dutyStartTime || '',
        dutyEndTime: prev.dutyEndTime || employee.dutyEndTime || '',
        monthlyAllowedLeaves:
          prev.monthlyAllowedLeaves ||
          (employee.monthlyAllowedLeaves != null
            ? String(employee.monthlyAllowedLeaves)
            : ''),
      }))
      return
    }
    const hasIdentityFields = extraFields.some((f) =>
      ['employeeName', 'designation', 'branch'].includes(f.key),
    )
    if (!hasIdentityFields) return
    setFields((prev) => ({
      ...prev,
      senderTitle:
        prev.senderTitle || (urduMode ? 'چیئرمین ایڈمن ڈیپارٹمنٹ' : ''),
      employeeName:
        prev.employeeName ||
        (urduMode ? transliterateName(employee.fullName) : employee.fullName) ||
        '',
      designation:
        prev.designation ||
        (urduMode
          ? translateDesignation(employee.currentDesignation)
          : employee.currentDesignation ?? '') ||
        '',
      branch:
        prev.branch ||
        (urduMode
          ? translateBranch(employee.currentBranch?.name)
          : employee.currentBranch?.name ?? '') ||
        '',
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        templateCode: customCode,
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
        templateCode: customCode,
        extraFields: buildExtraFieldsPayload(),
      }),
    onSuccess: async (data) => {
      const ref = letterReference(data.letter)
      queryClient.invalidateQueries({ queryKey: ['letters', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['letters'] })
      if (data.reusedExisting && data.letter.letterType === 'APPOINTMENT') {
        toast({
          title: 'Existing appointment draft loaded',
          description:
            'New form values were not saved. Opening the last saved draft.',
        })
        onOpenChange(false)
        setFields({})
        setPreviewHtml(null)
        onOpenAppointmentDraft?.(data.letter, data.previewHtml)
        return
      }
      toast({
        title: 'Letter generated successfully',
        description: `Reference: ${ref}`,
      })
      onOpenChange(false)
      setFields({})
      setPreviewHtml(null)
      if (data.letter.letterType === 'APPOINTMENT' && data.letter.status === 'DRAFT') {
        onOpenAppointmentDraft?.(data.letter, data.previewHtml)
        return
      }
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
              value={selectedValue}
              onValueChange={(v) => {
                setSelectedValue(v)
                setFields({})
                setPreviewHtml(null)
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GENERATE_LETTER_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
                {customTemplates.map((t) => (
                  <SelectItem key={t.code} value={`custom:${t.code}`}>
                    {t.name}
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
                  {field.type === 'select' ? (
                    <Select
                      value={fields[field.key] ?? ''}
                      onValueChange={(value) => {
                        const normalized = value === '__custom__' ? '' : value
                        setPreviewHtml(null)
                        setFields((f) => {
                          const next = { ...f, [field.key]: normalized }
                          if (field.key === 'finePreset') {
                            const monthYear = format(new Date(), 'MMMM yyyy')
                            if (value === 'UNIFORM') {
                              next.fineAmount = next.fineAmount || '200/-'
                              next.deductionMonth = next.deductionMonth || monthYear
                            } else if (value === 'ABSENT') {
                              next.fineAmount = next.fineAmount || 'دو یوم کی تنخواہ'
                              next.deductionMonth = next.deductionMonth || monthYear
                            } else if (value === 'LATE_DEDUCTION') {
                              next.fineAmount = next.fineAmount || 'ایک یوم کی تنخواہ'
                              next.deductionMonth = next.deductionMonth || monthYear
                            } else if (value === 'ELECTRICITY') {
                              next.deductionMonth = next.deductionMonth || monthYear
                            }
                          }
                          return next
                        })
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={field.label} />
                      </SelectTrigger>
                      <SelectContent>
                        {(field.options ?? []).map((opt) => (
                          <SelectItem
                            key={opt.value || '__custom__'}
                            value={opt.value || '__custom__'}
                          >
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : field.type === 'textarea' ? (
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
                      step={field.step}
                      min={field.min}
                      max={field.max}
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
