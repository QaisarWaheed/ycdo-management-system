import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { lettersApi } from '@/api/endpoints/letters'
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
import { getLetterExtraFields, letterReference } from '@/lib/letterFieldConfig'
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
  const [letterType, setLetterType] = useState<LetterType>('APPOINTMENT')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)

  const extraFields = getLetterExtraFields(letterType)
  const isAppointment = letterType === 'APPOINTMENT'

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

  const requiredFieldsFilled = extraFields.every(
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
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Preview failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

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
          const blob = await lettersApi.getPdf(data.letter.id)
          window.open(URL.createObjectURL(blob), '_blank')
        } catch {
          toast({
            title: 'File unavailable — please reissue',
            variant: 'destructive',
          })
        }
      }
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generate Letter</DialogTitle>
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

          {isAppointment && (
            <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              Profile fields and duty times are filled automatically. Preview
              before issuing (does not consume a letter number).
            </p>
          )}

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

          {isAppointment && previewHtml && (
            <iframe
              title="Letter preview"
              className="h-[45vh] w-full rounded border bg-white"
              srcDoc={previewHtml}
            />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {isAppointment && (
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
              mutation.isPending ||
              (isAppointment && (!requiredFieldsFilled || !previewHtml))
            }
          >
            {mutation.isPending
              ? 'Generating...'
              : isAppointment
                ? 'Issue Letter'
                : 'Generate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
