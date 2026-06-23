import api from '../axios'

export const qualificationsApi = {
  create: (data: Record<string, unknown>) => api.post('/qualifications', data),
  getByEmployee: (employeeId: string) =>
    api.get(`/qualifications/${employeeId}`),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/qualifications/${id}`, data),
  delete: (id: string) => api.delete(`/qualifications/${id}`),
}
