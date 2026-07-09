import { create } from 'zustand'
import type { User } from '@/types'
import { isHrmsSystemUser } from '@/lib/hrmsAccess'

interface AuthState {
  token: string | null
  user: User | null
  isAuthenticated: boolean
  login: (token: string, user: User) => void
  logout: () => void
  hydrate: () => void
}

function readStoredUser(): User | null {
  const raw = localStorage.getItem('hrms_user')
  if (!raw) return null
  try {
    const user = JSON.parse(raw) as User
    if (!isHrmsSystemUser(user)) {
      localStorage.removeItem('hrms_token')
      localStorage.removeItem('hrms_user')
      return null
    }
    return user
  } catch {
    return null
  }
}

const storedToken = localStorage.getItem('hrms_token')
const storedUser = readStoredUser()

export const useAuthStore = create<AuthState>((set) => ({
  token: storedUser ? storedToken : null,
  user: storedUser,
  isAuthenticated: !!storedToken && !!storedUser,
  login: (token, user) => {
    if (!isHrmsSystemUser(user)) {
      throw new Error('HRMS_ACCESS_DENIED')
    }
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
    const user = readStoredUser()
    set({
      token: user ? token : null,
      user,
      isAuthenticated: !!token && !!user,
    })
  },
}))
