import api from '../axios'

export interface BiometricDevice {
  id: string
  deviceId: string
  branchId: string
  label?: string | null
  createdAt: string
  branch?: { id: string; name: string }
}

export const biometricDevicesApi = {
  getAll: () => api.get<unknown, BiometricDevice[]>('/biometric-devices'),
  create: (data: {
    deviceId: string
    branchId: string
    label?: string
  }) => api.post<unknown, BiometricDevice>('/biometric-devices', data),
  update: (
    id: string,
    data: { deviceId?: string; branchId?: string; label?: string },
  ) => api.patch<unknown, BiometricDevice>(`/biometric-devices/${id}`, data),
  remove: (id: string) => api.delete(`/biometric-devices/${id}`),
}
