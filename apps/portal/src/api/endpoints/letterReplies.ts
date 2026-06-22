import api from '../axios'
import type { LetterReply } from '@/types'

export const letterRepliesApi = {
  reply: (data: { letterId: string; replyText: string }) =>
    api.post('/letter-replies', data),
  getMyReplies: () => api.get<unknown, LetterReply[]>('/letter-replies/my'),
}
