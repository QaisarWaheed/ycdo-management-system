import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { getLetterExtraFields } from '@/lib/letterFieldConfig'
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

  const mutation = useMutation({
    mutationFn: () =>
      lettersApi.generate({
        employeeId,
        letterType,
        extraFields: Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== ''),
        ),
      }),
    onSuccess: async (data) => {
      toast({ title: 'Letter generated successfully' })
      queryClient.invalidateQueries({ queryKey: ['letters', employeeId] })
      onOpenChange(false)
      if (data?.letter?.id) {
        try {
          const blob = await lettersApi.getPdf(data.letter.id)
          window.open(URL.createObjectURL(blob), '_blank')
        } catch {
          /* PDF open optional */
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

  const extraFields = getLetterExtraFields(letterType)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
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
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={fields[field.key] ?? ''}
                  onChange={(e) =>
                    setFields((f) => ({ ...f, [field.key]: e.target.value }))
                  }
                />
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary-dark"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Generating...' : 'Generate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
