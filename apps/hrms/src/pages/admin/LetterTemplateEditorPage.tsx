import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import {
  letterTemplatesApi,
  type LetterTemplateInput,
} from '@/api/endpoints/letterTemplates'
import { RichTextEditor } from '@/components/letters/RichTextEditor'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import type { LetterTemplateFieldDef } from '@/types'

const SHARED_FIELDS = [
  { key: 'employeeName', label: 'Employee Name (auto-fetched)' },
  { key: 'designation', label: 'Designation (auto-fetched)' },
  { key: 'branch', label: 'Branch (auto-fetched)' },
  { key: 'senderTitle', label: 'Sender Title' },
  { key: 'issueDate', label: 'Issue Date' },
  { key: 'letterNo', label: 'Letter Number' },
]

const FIELD_TYPES: { value: LetterTemplateFieldDef['type']; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Paragraph' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
]

function emptyField(): LetterTemplateFieldDef {
  return { key: '', label: '', type: 'text', onTemplate: true, required: true }
}

export function LetterTemplateEditorPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { code } = useParams<{ code: string }>()
  const isNew = !code

  const { data: existing, isLoading } = useQuery({
    queryKey: ['letter-templates', code],
    queryFn: () => letterTemplatesApi.getOne(code as string),
    enabled: !isNew,
  })

  const [form, setForm] = useState({
    code: '',
    name: '',
    letterCode: '',
    primaryLanguage: 'ur' as 'ur' | 'en',
    subjectUr: '',
    subjectEn: '',
    enTitle: '',
    enPrescribed: '',
    enSubtitle: '',
    bodyHtml: '',
    bodyHtmlEn: '',
  })
  const [fields, setFields] = useState<LetterTemplateFieldDef[]>([])
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'ur' | 'en'>('ur')

  useEffect(() => {
    if (!existing) return
    setForm({
      code: existing.code,
      name: existing.name,
      letterCode: existing.letterCode ?? '',
      primaryLanguage: existing.primaryLanguage,
      subjectUr: existing.subjectUr ?? '',
      subjectEn: existing.subjectEn ?? '',
      enTitle: existing.enTitle ?? '',
      enPrescribed: existing.enPrescribed ?? '',
      enSubtitle: existing.enSubtitle ?? '',
      bodyHtml: existing.bodyHtml ?? '',
      bodyHtmlEn: existing.bodyHtmlEn ?? '',
    })
    setFields(existing.fieldsSchema ?? [])
    setActiveTab(existing.primaryLanguage)
  }, [existing])

  const insertableFields = useMemo(
    () => [
      ...fields.filter((f) => f.key).map((f) => ({ key: f.key, label: f.label || f.key })),
      ...SHARED_FIELDS,
    ],
    [fields],
  )

  const previewMutation = useMutation({
    mutationFn: () =>
      letterTemplatesApi.preview(activeTab === 'en' ? form.bodyHtmlEn : form.bodyHtml),
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

  const buildPayload = (): LetterTemplateInput => ({
    name: form.name.trim(),
    bodyHtml: form.bodyHtml,
    bodyHtmlEn: form.bodyHtmlEn || undefined,
    subjectUr: form.subjectUr || undefined,
    subjectEn: form.subjectEn || undefined,
    enTitle: form.enTitle || undefined,
    enPrescribed: form.enPrescribed || undefined,
    enSubtitle: form.enSubtitle || undefined,
    letterCode: form.letterCode || undefined,
    primaryLanguage: form.primaryLanguage,
    fieldsSchema: fields.filter((f) => f.key.trim()),
    requiredVars: fields.filter((f) => f.required && f.key.trim()).map((f) => f.key.trim()),
  })

  const saveMutation = useMutation({
    mutationFn: () => {
      if (isNew) {
        return letterTemplatesApi.create({ ...buildPayload(), code: form.code.trim().toUpperCase() })
      }
      return letterTemplatesApi.update(code as string, buildPayload())
    },
    onSuccess: () => {
      toast({ title: isNew ? 'Template created' : 'Template updated' })
      queryClient.invalidateQueries({ queryKey: ['letter-templates'] })
      navigate('/admin/letter-templates')
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Save failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  if (user?.role !== 'IT_ADMIN' && user?.role !== 'SUPER_ADMIN') {
    return <Navigate to="/dashboard" replace />
  }

  if (!isNew && isLoading) {
    return <p className="text-sm text-text-secondary">Loading template…</p>
  }

  const isBuiltIn = !isNew && existing && !existing.isCustom
  const canSave = form.name.trim() && form.bodyHtml.trim() && (isNew ? form.code.trim() : true)

  const updateField = (index: number, patch: Partial<LetterTemplateFieldDef>) => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  }

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/admin/letter-templates')}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold">
            {isNew ? 'New Letter Template' : `Edit — ${form.name || form.code}`}
          </h1>
          {isBuiltIn && (
            <p className="text-sm text-amber-700">
              This is a built-in letter type. You can edit its wording live, but
              its code and fields cannot be removed.
            </p>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label>Code {isNew && '*'}</Label>
            <Input
              value={form.code}
              disabled={!isNew}
              placeholder="PROMOTION_LETTER"
              onChange={(e) =>
                setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Promotion Letter"
            />
          </div>
          <div className="space-y-2">
            <Label>Short Ref Code</Label>
            <Input
              value={form.letterCode}
              maxLength={6}
              placeholder="e.g. PRM"
              onChange={(e) => setForm((f) => ({ ...f, letterCode: e.target.value.toUpperCase() }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Primary Language</Label>
            <Select
              value={form.primaryLanguage}
              onValueChange={(v) => setForm((f) => ({ ...f, primaryLanguage: v as 'ur' | 'en' }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ur">Urdu</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-text-secondary">
              The version actually printed on the issued letter.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Urdu Subject (عنوان)</Label>
            <Input
              dir="rtl"
              value={form.subjectUr}
              onChange={(e) => setForm((f) => ({ ...f, subjectUr: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>English Subject / Title</Label>
            <Input
              value={form.enTitle}
              placeholder="Notification"
              onChange={(e) => setForm((f) => ({ ...f, enTitle: e.target.value }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Input Fields</h2>
              <p className="text-sm text-text-secondary">
                Fields HR fills in when issuing this letter. Mark a field
                required to block issuing until it's filled.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFields((prev) => [...prev, emptyField()])}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add field
            </Button>
          </div>

          {fields.length === 0 ? (
            <p className="rounded border border-dashed p-4 text-center text-sm text-text-secondary">
              No custom fields yet — add one, then insert it into the letter
              body via "Insert field" in the editor toolbar below.
            </p>
          ) : (
            <div className="space-y-2">
              {fields.map((field, i) => (
                <div
                  key={i}
                  className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[1fr_1fr_140px_auto_auto_auto]"
                >
                  <Input
                    placeholder="fieldKey"
                    value={field.key}
                    onChange={(e) =>
                      updateField(i, { key: e.target.value.replace(/[^a-zA-Z0-9]/g, '') })
                    }
                  />
                  <Input
                    placeholder="Label shown to HR"
                    value={field.label}
                    onChange={(e) => updateField(i, { label: e.target.value })}
                  />
                  <Select
                    value={field.type ?? 'text'}
                    onValueChange={(v) => updateField(i, { type: v as LetterTemplateFieldDef['type'] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value as string}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-1 whitespace-nowrap text-xs">
                    <input
                      type="checkbox"
                      checked={!!field.required}
                      onChange={(e) => updateField(i, { required: e.target.checked })}
                    />
                    Required
                  </label>
                  <label className="flex items-center gap-1 whitespace-nowrap text-xs">
                    <input
                      type="checkbox"
                      checked={!!field.onTemplate}
                      onChange={(e) => updateField(i, { onTemplate: e.target.checked })}
                    />
                    On canvas
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red-600"
                    onClick={() => setFields((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="font-semibold">Letter Content</h2>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'ur' | 'en')}>
            <TabsList>
              <TabsTrigger value="ur">اردو (Urdu)</TabsTrigger>
              <TabsTrigger value="en">English</TabsTrigger>
            </TabsList>
            <TabsContent value="ur">
              <RichTextEditor
                dir="rtl"
                value={form.bodyHtml}
                onChange={(html) => setForm((f) => ({ ...f, bodyHtml: html }))}
                fields={insertableFields}
              />
            </TabsContent>
            <TabsContent value="en">
              <RichTextEditor
                dir="ltr"
                value={form.bodyHtmlEn}
                onChange={(html) => setForm((f) => ({ ...f, bodyHtmlEn: html }))}
                fields={insertableFields}
              />
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              {previewMutation.isPending ? 'Rendering…' : 'Preview'}
            </Button>
          </div>

          {previewHtml && (
            <iframe
              title="Template preview"
              className="h-[60vh] w-full rounded border bg-white"
              srcDoc={previewHtml}
            />
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate('/admin/letter-templates')}>
          Cancel
        </Button>
        <Button
          className="bg-primary hover:bg-primary-dark"
          disabled={!canSave || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? 'Saving…' : isNew ? 'Create Template' : 'Save Changes'}
        </Button>
      </div>
    </div>
  )
}
