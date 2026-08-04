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
    stipendRecords?: Array<{ basicStipend: number | string }>
  }
  submittedBy?: {
    id: string
    email: string
    employee?: { fullName: string } | null
  }
}

export const employeeOnboardingApi = {
  getPending: () =>
    api.get<unknown, EmployeeOnboardingApproval[]>(
      '/employee-onboarding/pending',
    ),
  getOne: (id: string) =>
    api.get<unknown, EmployeeOnboardingApproval>(
      `/employee-onboarding/${id}`,
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
