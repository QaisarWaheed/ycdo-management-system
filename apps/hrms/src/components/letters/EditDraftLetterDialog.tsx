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
}: {
  letter: Letter | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [fields, setFields] = useState<Record<string, string>>({})

  const letterType = (letter?.letterType ?? 'WARNING') as LetterType
  const extraFields = useMemo(
    () => getLetterExtraFields(letterType),
    [letterType],
  )
  const urduMode = isUrduLetterType(letterType)
  const templateFields = extraFields.filter((f) => f.onTemplate)
  const sideFields = extraFields.filter((f) => !f.onTemplate)

  useEffect(() => {
    if (open && letter) {
      setFields(fieldsFromLetter(letter))
    }
  }, [open, letter])

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
      lettersApi.update(letter!.id, {
        extraFields: buildExtraFieldsPayload(),
      }),
    onSuccess: (data) => {
      toast({
        title: 'Draft letter updated',
        description: `${letterReference(data.letter)} remains a draft until you send it`,
      })
      queryClient.invalidateQueries({ queryKey: ['letters'] })
      queryClient.invalidateQueries({ queryKey: ['letters-pending'] })
      onOpenChange(false)
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
      void queryClient.invalidateQueries({ queryKey: ['letters'] })
    },
  })

  if (!letter) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            Edit draft — {letterReference(letter)}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-text-secondary">
          Saving updates the draft only. It does not send the letter or change
          employee status.
        </p>

        {urduMode ? (
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
                        setFields((f) => ({ ...f, [field.key]: e.target.value }))
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
                      value={fields[field.key] ?? ''}
                      onChange={(e) =>
                        setFields((f) => ({ ...f, [field.key]: e.target.value }))
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

        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
