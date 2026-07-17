import api from '../axios'

export type AppPermission =
  | 'ATTENDANCE_MARK'
  | 'ATTENDANCE_EDIT'
  | 'LEAVE_APPROVE'
  | 'LEAVE_APPLY_OTHERS'
  | 'PAYROLL_MANAGE'
  | 'EMPLOYEES_CREATE'
  | 'EMPLOYEES_EDIT'
  | 'DISCIPLINARY_MANAGE'
  | 'LETTERS_GENERATE'
  | 'INCENTIVES_MANAGE'
  | 'RECRUITMENT_MANAGE'
  | 'REPORTS_VIEW'
  | 'BROADCASTS_SEND'
  | 'ORG_SETUP'

export interface ManagerScopeInput {
  projectId: string
  departmentId: string
  designationId?: string | null
}

export interface ManagerScopeView extends ManagerScopeInput {
  id?: string
  projectName?: string
  departmentName?: string
  designationTitle?: string | null
  label: string
}

export interface HospitalScopeOption {
  id: string
  name: string
  type: string
  departments: {
    id: string
    name: string
    designations: { id: string; title: string }[]
  }[]
}

export interface UserAccessRecord {
  id: string
  email: string
  role: string
  roles?: string[]
  additionalRoles?: string[]
  managerScopes?: ManagerScopeView[]
  isActive: boolean
  branchId?: string | null
  employeeId?: string | null
  createdAt: string
  lastLogin?: string | null
  employee?: {
    fullName: string
    employeeCode: string
    currentBranch?: {
      id: string
      name: string
      abbreviation?: string | null
      address?: string | null
      projectId?: string | null
      project?: { id: string; name: string } | null
    } | null
  } | null
  branch?: {
    id: string
    name: string
    abbreviation?: string | null
    address?: string | null
    projectId?: string | null
    project?: { id: string; name: string } | null
  } | null
  passwordRecord?: {
    plainText: string
    updatedAt: string
  } | null
  permissions: { permission: AppPermission; granted: boolean }[]
}

export interface EffectivePermission {
  permission: AppPermission
  label: string
  effective: boolean
  source: 'role' | 'override_grant' | 'override_deny'
}

export interface UserAccessDetail extends UserAccessRecord {
  effectivePermissions: EffectivePermission[]
  assignableRoles: string[]
  additionalAssignableRoles?: string[]
  hospitalScopeOptions?: HospitalScopeOption[]
}

export interface LoginAccessSummary {
  total: number
  employeeLogins: number
  systemLogins: number
  active: number
  disabled: number
  missingEmployeeLogins: number
}

export interface PermissionOverrideInput {
  permission: AppPermission
  granted?: boolean | null
}

export const userAccessApi = {
  getAll: (params?: {
    employeeOnly?: boolean
    systemOnly?: boolean
    branchId?: string
    projectId?: string
    activeOnly?: boolean
    search?: string
  }) =>
    api.get<unknown, UserAccessRecord[]>('/user-access', {
      params: {
        ...(params?.employeeOnly ? { employeeOnly: 'true' } : {}),
        ...(params?.systemOnly ? { systemOnly: 'true' } : {}),
        ...(params?.branchId ? { branchId: params.branchId } : {}),
        ...(params?.projectId ? { projectId: params.projectId } : {}),
        ...(params?.activeOnly === true ? { activeOnly: 'true' } : {}),
        ...(params?.activeOnly === false ? { activeOnly: 'false' } : {}),
        ...(params?.search ? { search: params.search } : {}),
      },
    }),

  getMeta: () =>
    api.get<
      unknown,
      {
        permissions: { permission: AppPermission; label: string }[]
        assignableRoles: string[]
        additionalAssignableRoles?: string[]
        permissionLabels: Record<AppPermission, string>
        hospitalScopeOptions?: HospitalScopeOption[]
      }
    >('/user-access/meta'),

  getSummary: () =>
    api.get<unknown, LoginAccessSummary>('/user-access/summary'),

  syncEmployeeLogins: () =>
    api.post<unknown, { created: number; remaining: number }>(
      '/user-access/sync-employee-logins',
    ),

  toggleActive: (userId: string) =>
    api.patch<unknown, { id: string; isActive: boolean }>(
      `/user-access/${userId}/toggle-active`,
    ),

  getOne: (userId: string) =>
    api.get<unknown, UserAccessDetail>(`/user-access/${userId}`),

  update: (
    userId: string,
    data: {
      isActive?: boolean
      role?: string
      additionalRoles?: string[]
      managerScopes?: ManagerScopeInput[]
      branchId?: string | null
      permissions?: PermissionOverrideInput[]
    },
  ) => api.patch<unknown, UserAccessDetail>(`/user-access/${userId}`, data),

  createSystemLogin: (data: {
    email: string
    password: string
    role: string
    branchId?: string
  }) => api.post<unknown, UserAccessDetail>('/user-access', data),

  resetPassword: (userId: string, newPassword: string) =>
    api.patch(`/user-access/${userId}/password`, { newPassword }),
}
