import { create } from 'zustand'
import type { User } from '@/types'

interface AuthState {
  token: string | null
  user: User | null
  isAuthenticated: boolean
  login: (token: string, user: User) => void
  logout: () => void
  hydrate: () => void
}

const storedToken = localStorage.getItem('hrms_token')
const storedUser = localStorage.getItem('hrms_user')

export const useAuthStore = create<AuthState>((set) => ({
  token: storedToken,
  user: storedUser ? (JSON.parse(storedUser) as User) : null,
  isAuthenticated: !!storedToken,
  login: (token, user) => {
    localStorage.setItem('hrms_token', token)
    localStorage.setItem('hrms_user', JSON.stringify(user))
    set({ token, user, isAuthenticated: true })
  },
  logout: () => {
    localStorage.removeItem('hrms_token')
    localStorage.removeItem('hrms_user')
    set({ token: null, user: null, isAuthenticated: false })
  },
  hydrate: () => {
    const token = localStorage.getItem('hrms_token')
    const userRaw = localStorage.getItem('hrms_user')
    set({
      token,
      user: userRaw ? (JSON.parse(userRaw) as User) : null,
      isAuthenticated: !!token,
    })
  },
}))
