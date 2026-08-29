import api from '../axios'
import type { Letter, LetterTemplate, LetterWhatsAppShare } from '@/types'

interface GenerateLetterResponse {
  letter: Letter
  previewHtml: string
}

export const lettersApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, Letter[]>('/letters', { params }),
  getPending: () => api.get<unknown, Letter[]>('/letters/pending'),
  getOne: (id: string) => api.get<unknown, Letter>(`/letters/${id}`),
  getTemplates: () =>
    api.get<unknown, LetterTemplate[]>('/letters/templates'),
  preview: (data: Record<string, unknown>) =>
    api.post<unknown, { previewHtml: string; variables: Record<string, unknown> }>(
      '/letters/preview',
      data,
    ),
  previewAppointment: (data: Record<string, unknown>) =>
    api.post<
      unknown,
      {
        previewHtml: string
        variables: Record<string, unknown>
        mapping?: {
          templateCode: string
          language: string
          match: string
        }
      }
    >('/letters/appointment-preview', data),
  generate: (data: Record<string, unknown>) =>
    api.post<unknown, GenerateLetterResponse>('/letters', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch<unknown, GenerateLetterResponse>(`/letters/${id}`, data),
  send: (id: string) =>
    api.post<
      unknown,
      { letter: Letter; alreadySent?: boolean; message?: string }
    >(`/letters/${id}/send`),
  reverse: (id: string, reason: string) =>
    api.post<
      unknown,
      {
        letter: Letter
        fineUndone?: boolean
        fineSkippedReason?: string | null
        message?: string
      }
    >(`/letters/${id}/reverse`, { reason }),
  getPdf: (id: string) =>
    api.get<unknown, Blob>(`/letters/${id}/pdf`, { responseType: 'blob' }),
  getWhatsAppShare: (id: string) =>
    api.get<unknown, LetterWhatsAppShare>(`/letters/${id}/whatsapp-share`),
  markWhatsAppShared: (id: string) =>
    api.post<unknown, Letter>(`/letters/${id}/mark-whatsapp-shared`),
  markPrinted: (id: string) =>
    api.patch<unknown, Letter>(`/letters/${id}/printed`),
  delete: (id: string) => api.delete(`/letters/${id}`),
  listAppointmentMappings: () =>
    api.get<unknown, AppointmentMappingRow[]>('/letters/appointment-mappings'),
  listAppointmentMappingTemplates: () =>
    api.get<unknown, AppointmentMappingTemplate[]>(
      '/letters/appointment-mappings/templates',
    ),
  appointmentMappingCoverage: () =>
    api.get<unknown, AppointmentCoverageResponse>(
      '/letters/appointment-mappings/coverage',
    ),
  createAppointmentMapping: (data: Record<string, unknown>) =>
    api.post<unknown, AppointmentMappingRow>(
      '/letters/appointment-mappings',
      data,
    ),
  updateAppointmentMapping: (id: string, data: Record<string, unknown>) =>
    api.patch<unknown, AppointmentMappingRow>(
      `/letters/appointment-mappings/${id}`,
      data,
    ),
  deleteAppointmentMapping: (id: string) =>
    api.delete<unknown, { id: string; deleted?: boolean; active?: boolean }>(
      `/letters/appointment-mappings/${id}`,
    ),
  previewAppointmentMapping: (data: Record<string, unknown>) =>
    api.post<
      unknown,
      { previewHtml: string; templateCode: string; language: string }
    >('/letters/appointment-mappings/preview', data),
}

export interface AppointmentMappingRow {
  id: string
  departmentId: string | null
  designationId: string | null
  language: 'UR' | 'EN'
  templateCode: string
  active: boolean
  department?: { id: string; name: string } | null
  designation?: { id: string; title: string } | null
}

export interface AppointmentMappingTemplate {
  code: string
  name: string
  familyName?: string
  language?: 'UR' | 'EN' | null
  active: boolean
}

export interface AppointmentCoverageRow {
  department: string
  departmentId: string | null
  designation: string
  designationId: string | null
  employeeCount: number
  designationCatalogExists: boolean
  mappingExists: boolean
  templateCode: string | null
  language: 'UR' | 'EN' | null
  status:
    | 'MAPPED'
    | 'MISSING_MAPPING'
    | 'MISSING_DESIGNATION_CATALOG'
    | 'INVALID_ROLE'
    | 'INACTIVE_MAPPING'
}

export interface AppointmentCoverageResponse {
  summary: {
    total: number
    mapped: number
    missingMapping: number
    missingCatalog: number
    invalidRole: number
    inactiveMapping: number
  }
  rows: AppointmentCoverageRow[]
}
