import api from '../axios'

export type EmployeeApproverTarget = 'PRESIDENT' | 'FOUNDER' | 'CHAIRMAN_ADMIN'

export type EmployeeOnboardingStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface EmployeeOnboardingApproval {
  id: string
  employeeId: string
  submittedById: string
  approverTarget: EmployeeApproverTarget
  status: EmployeeOnboardingStatus
  formSnapshot: Record<string, unknown>
  physicalFormUrl?: string | null
  physicalFormMimeType?: string | null
  physicalFormFileName?: string | null
  reviewNote?: string | null
  reviewedById?: string | null
  reviewedAt?: string | null
  createdAt: string
  updatedAt: string
  employee?: {
    id: string
    fullName: string
    employeeCode: string
    photoUrl?: string | null
    currentDesignation?: string | null
    joiningDate: string
    currentBranch?: { name: string; abbreviation?: string | null }
    currentDepartment?: { name: string } | null
    academicQualifications?: Array<{
      degree: string
      boardUniversity: string
      qualType: string
      obtainedMarks?: string | null
      divisionGrade?: string | null
    }>
    previousEmployments?: Array<{
      organizationName: string
      ownerAdminName?: string | null
      contactNumber?: string | null
      postalAddress?: string | null
      totalExperience?: string | null
    }>
    stipendRecords?: Array<{ basicStipend: number | string }>
  }
  submittedBy?: {
    id: string
    email: string
    employee?: { fullName: string } | null
  }
  reviewedBy?: {
    id: string
    email: string
    employee?: { fullName: string } | null
  } | null
}

export const APPROVER_OPTIONS: {
  value: EmployeeApproverTarget
  label: string
  description: string
}[] = [
  {
    value: 'PRESIDENT',
    label: 'President',
    description: 'Send employee form to the President for approval',
  },
  {
    value: 'FOUNDER',
    label: 'Founder',
    description: 'Send employee form to the Founder for approval',
  },
  {
    value: 'CHAIRMAN_ADMIN',
    label: 'Chairman Admin',
    description: 'Send employee form to the Chairman Admin for approval',
  },
]

export const employeeOnboardingApi = {
  getPending: () =>
    api.get<unknown, EmployeeOnboardingApproval[]>(
      '/employee-onboarding/pending',
    ),
  getOne: (id: string) =>
    api.get<unknown, EmployeeOnboardingApproval>(
      `/employee-onboarding/${id}`,
    ),
  getWhatsAppShare: (params: {
    approverTarget?: EmployeeApproverTarget
    employeeId?: string
    phone?: string
    hrmsBaseUrl?: string
  }) =>
    api.get<
      unknown,
      {
        approverTarget: EmployeeApproverTarget
        approverLabel: string
        phoneE164: string | null
        phoneConfigured: boolean
        message: string
        waUrl: string
        loginUrl: string
      }
    >('/employee-onboarding/whatsapp-share', { params }),
  uploadPhysicalForm: (employeeId: string, formData: FormData) =>
    api.post<unknown, EmployeeOnboardingApproval>(
      `/employee-onboarding/employee/${employeeId}/physical-form`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    ),
  approve: (id: string, reviewNote?: string) =>
    api.post<unknown, EmployeeOnboardingApproval>(
      `/employee-onboarding/${id}/approve`,
      { reviewNote },
    ),
  reject: (id: string, reviewNote: string) =>
    api.post<unknown, EmployeeOnboardingApproval>(
      `/employee-onboarding/${id}/reject`,
      { reviewNote },
    ),
}
