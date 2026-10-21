import api from '@/api/axios'

export interface TeamPair {
  departmentId: string
  designation: string
  employees: number
  assignment: { id: string; userId: string; email: string } | null
}

export interface TeamOptions {
  departments: Array<{ id: string; name: string }>
  logins: Array<{ id: string; email: string; name: string | null }>
  pairs: TeamPair[]
}

export interface MyTeamEmployee {
  id: string
  fullName: string
  employeeCode: string
  photoUrl: string | null
  designation: string | null
  branch: string | null
  department: string | null
  progress: { rating: number; remarks: string | null } | null
  suggestions: Array<{ type: string; amount: number; status: string; approvedAmount: number | null }>
  extraDays: Array<{ id: string; date: string; status: string; note: string | null }>
}

export interface MyTeam {
  month: number
  year: number
  assignments: Array<{ department: string; designation: string }>
  incentiveTypes: Array<{ id: string; name: string }>
  employees: MyTeamEmployee[]
}

/** Team In-charge: IT gives department + designation pairs to a login; that login rates its team. */
export const teamApi = {
  options: () => api.get<unknown, TeamOptions>('/team/assignments'),
  assign: (userId: string, pairs: Array<{ departmentId: string; designation: string }>) =>
    api.post<unknown, { assigned: number }>('/team/assignments', { userId, pairs }),
  unassign: (id: string) => api.delete(`/team/assignments/${id}`),
  my: (month: number, year: number) => api.get<unknown, MyTeam>('/team/my', { params: { month, year } }),
  saveProgress: (data: { employeeId: string; month: number; year: number; rating: number; remarks?: string }) =>
    api.put('/team/progress', data),
}
