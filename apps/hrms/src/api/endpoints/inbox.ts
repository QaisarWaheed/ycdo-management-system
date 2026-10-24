import api from '@/api/axios'

export type InboxTab = 'todo' | 'sent' | 'done'

export interface InboxItem {
  key: string
  type: 'EXTRA_DAY' | 'OVERTIME' | 'TRANSFER' | 'WORKING_HOURS'
  id: string
  kind: 'day' | 'overtime' | 'change'
  employee: { id: string; name: string; code: string; branch: string | null }
  date: string
  minutes: number | null
  note: string | null
  status: string
  step: string
  requestedBy: string | null
  canDecide: boolean
  trail: Array<{ at: string | null; by: string | null; text: string; note: string | null }>
}

/** One Inbox for every login: to do, sent (and where it is now), done. */
export const inboxApi = {
  list: (tab: InboxTab) => api.get<unknown, { tab: InboxTab; items: InboxItem[] }>('/inbox', { params: { tab } }),
  count: () => api.get<unknown, { todo: number }>('/inbox/count'),
  /** Transfer / working-hours requests use their own approve / reject endpoints. */
  decideChange: (id: string, approve: boolean, note?: string) =>
    api.post(`/employee-change-requests/${id}/${approve ? 'approve' : 'reject'}`, { note }),
}
