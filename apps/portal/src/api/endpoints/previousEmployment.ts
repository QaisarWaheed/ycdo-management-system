import api from '../axios'

export const previousEmploymentApi = {
  create: (data: Record<string, unknown>) =>
    api.post('/previous-employment', data),
  getByEmployee: (employeeId: string) =>
    api.get(`/previous-employment/${employeeId}`),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/previous-employment/${id}`, data),
  delete: (id: string) => api.delete(`/previous-employment/${id}`),
}
