import api from '../axios'
import type { LetterTemplate, LetterTemplateFieldDef } from '@/types'

export interface LetterTemplateInput {
  name: string
  bodyHtml: string
  bodyHtmlEn?: string
  subjectUr?: string
  subjectEn?: string
  enTitle?: string
  enPrescribed?: string
  enSubtitle?: string
  letterCode?: string
  primaryLanguage?: 'ur' | 'en'
  fieldsSchema?: LetterTemplateFieldDef[]
  requiredVars?: string[]
  active?: boolean
}

export const letterTemplatesApi = {
  getAll: (includeInactive = true) =>
    api.get<unknown, LetterTemplate[]>('/letters/templates', {
      params: includeInactive ? { includeInactive: 'true' } : undefined,
    }),
  getOne: (code: string) =>
    api.get<unknown, LetterTemplate>(`/letters/templates/${code}`),
  create: (data: LetterTemplateInput & { code: string }) =>
    api.post<unknown, LetterTemplate>('/letters/templates', data),
  update: (code: string, data: Partial<LetterTemplateInput>) =>
    api.patch<unknown, LetterTemplate>(`/letters/templates/${code}`, data),
  delete: (code: string) =>
    api.delete<unknown, LetterTemplate>(`/letters/templates/${code}`),
  preview: (bodyHtml: string, variables?: Record<string, unknown>) =>
    api.post<unknown, { previewHtml: string }>('/letters/templates/preview', {
      bodyHtml,
      variables,
    }),
}
