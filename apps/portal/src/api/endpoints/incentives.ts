import api from '../axios'
import type { Incentive } from '@/types'

export const incentivesApi = {
  getByEmployee: (employeeId: string) =>
    api.get<unknown, Incentive[]>(`/incentives/employee/${employeeId}`),
}
