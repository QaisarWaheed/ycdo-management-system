import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { authApi } from '@/api/endpoints/auth'
import { useAuth } from '@/hooks/useAuth'
import { canAccessPortal } from '@/lib/portalRoles'
import { getApiErrorMessage } from '@/lib/apiErrorMessage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type LoginForm = z.infer<typeof loginSchema>

export function LoginPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const { login, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const redirectError = (location.state as { error?: string } | null)?.error

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (data: LoginForm) => {
    setError('')
    try {
      const response = await authApi.login(data.email, data.password)
      if (!canAccessPortal(response.user)) {
        setError('This account cannot sign in to the Employee Portal.')
        return
      }
      login(response.access_token, response.user)
      navigate('/dashboard')
    } catch (err) {
      if (err instanceof Error && err.message === 'PORTAL_ACCESS_DENIED') {
        setError('This account cannot sign in to the Employee Portal.')
        return
      }
      setError(getApiErrorMessage(err, 'Invalid email or password'))
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-surface">
      {/* Compact brand header — full width on all sizes */}
      <header className="bg-primary px-5 pb-8 pt-10 text-white sm:px-8 sm:pt-12">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-xl font-bold text-primary sm:h-14 sm:w-14 sm:text-2xl">
            Y
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight sm:text-3xl">YCDO</h1>
            <p className="truncate text-xs text-white/80 sm:text-sm">
              Youth Community Development Organization
            </p>
          </div>
        </div>
        <div className="mx-auto mt-5 max-w-md">
          <p className="text-base font-medium text-white/95 sm:text-lg">
            Employee Portal
          </p>
          <div className="mt-2 h-1 w-14 rounded bg-accent" />
          <p className="mt-3 text-sm text-white/75">
            Employees · Founder · Chairman Admin · President
          </p>
        </div>
      </header>

      {/* Form card sits under brand — never side-by-side on phones */}
      <div className="relative z-10 -mt-4 flex flex-1 flex-col px-4 pb-8 sm:px-6">
        <div className="mx-auto w-full max-w-md flex-1 rounded-2xl border border-border bg-white px-5 py-7 shadow-sm sm:px-8 sm:py-9">
          <p className="text-center text-sm text-text-secondary">Welcome back</p>
          <h2 className="mt-1 text-center text-xl font-bold text-text-primary sm:text-2xl">
            Sign in
          </h2>
          <p className="mt-2 text-center text-sm text-text-secondary">
            Attendance, leave, payroll, letters &amp; joining approvals
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                placeholder="you@ycdo.org"
                className="h-12 text-base"
                {...register('email')}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="h-12 pr-11 text-base"
                  {...register('password')}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-text-secondary"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="text-sm text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>

            {(error || redirectError) && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-destructive">
                {error || redirectError}
              </p>
            )}

            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-12 w-full bg-primary text-base hover:bg-primary-dark"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-text-secondary">
          YCDO Employee Portal v1.0 · Powered by YCDO IT Team
        </p>
      </div>
    </div>
  )
}
