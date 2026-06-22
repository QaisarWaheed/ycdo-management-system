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

function readStoredUser(): User | null {
  const raw = localStorage.getItem('portal_user')
  if (!raw) return null
  try {
    const user = JSON.parse(raw) as User
    if (user.role !== 'EMPLOYEE') {
      localStorage.removeItem('portal_token')
      localStorage.removeItem('portal_user')
      return null
    }
    return user
  } catch {
    return null
  }
}

const storedToken = localStorage.getItem('portal_token')
const storedUser = readStoredUser()

export const useAuthStore = create<AuthState>((set) => ({
  token: storedUser ? storedToken : null,
  user: storedUser,
  isAuthenticated: !!storedToken && !!storedUser,
  login: (token, user) => {
    if (user.role !== 'EMPLOYEE') {
      throw new Error('EMPLOYEE_ONLY')
    }
    localStorage.setItem('portal_token', token)
    localStorage.setItem('portal_user', JSON.stringify(user))
    set({ token, user, isAuthenticated: true })
  },
  logout: () => {
    localStorage.removeItem('portal_token')
    localStorage.removeItem('portal_user')
    set({ token: null, user: null, isAuthenticated: false })
  },
  hydrate: () => {
    const token = localStorage.getItem('portal_token')
    const user = readStoredUser()
    set({
      token: user ? token : null,
      user,
      isAuthenticated: !!token && !!user,
    })
  },
}))
