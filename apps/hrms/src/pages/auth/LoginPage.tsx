import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Navigate, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { authApi } from '@/api/endpoints/auth'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type LoginForm = z.infer<typeof loginSchema>

const features = ['HR Management', 'Multi-Branch', 'Employee Lifecycle']

export function LoginPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const { login, isAuthenticated } = useAuth()
  const navigate = useNavigate()

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
      login(response.access_token, response.user)
      navigate('/dashboard', { replace: true })
    } catch {
      setError('Invalid email or password')
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Left panel */}
      <div className="flex w-[40%] flex-col justify-between bg-primary p-12 text-white">
        <div>
          <div className="mb-8 flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-2xl font-bold text-primary">
              Y
            </div>
            <div>
              <h1 className="text-3xl font-bold">YCDO</h1>
              <p className="text-sm text-white/80">
                Youth Community Development Organization
              </p>
            </div>
          </div>
          <p className="text-lg italic text-white/90">
            Donate Love, Money and Time
          </p>
          <div className="mt-2 h-1 w-16 rounded bg-accent" />
        </div>

        <ul className="space-y-3">
          {features.map((item) => (
            <li key={item} className="flex items-center gap-2 text-white/90">
              <span className="text-accent">✓</span>
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Right panel */}
      <div className="flex w-[60%] items-center justify-center bg-white px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-white">
              Y
            </div>
          </div>

          <p className="text-center text-sm text-text-secondary">Welcome back</p>
          <h2 className="mt-1 text-center text-2xl font-bold text-text-primary">
            Sign in to YCDO HRMS
          </h2>
          <p className="mt-2 text-center text-sm text-text-secondary">
            Manage your HR operations across all branches
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@ycdo.org"
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
                  placeholder="••••••••"
                  {...register('password')}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>

            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-primary hover:bg-primary-dark"
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

          <p className="mt-10 text-center text-xs text-text-secondary">
            YCDO HRMS v1.0 · Powered by YCDO IT Team
          </p>
        </div>
      </div>
    </div>
  )
}
