import api from '../axios'
import type { LetterReply } from '@/types'

export const letterRepliesApi = {
  getRepliesByLetter: (letterId: string) =>
    api.get<unknown, LetterReply[]>(`/letter-replies/letter/${letterId}`),
}
