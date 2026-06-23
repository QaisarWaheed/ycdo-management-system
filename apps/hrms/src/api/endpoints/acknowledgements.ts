import api from '../axios'
import type { AllegationAcknowledgement, Letter } from '@/types'

export const acknowledgementsApi = {
  acknowledge: (data: { letterId: string }) =>
    api.post<unknown, AllegationAcknowledgement>('/acknowledgements', data),
  getMy: () => api.get<unknown, AllegationAcknowledgement[]>('/acknowledgements/my'),
  getPending: () => api.get<unknown, Letter[]>('/acknowledgements/pending'),
  getByLetter: (letterId: string) =>
    api.get<unknown, AllegationAcknowledgement>(
      `/acknowledgements/letter/${letterId}`,
    ),
}
