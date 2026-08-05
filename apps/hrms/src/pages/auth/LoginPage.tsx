import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Navigate, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { authApi } from '@/api/endpoints/auth'
import { useAuth } from '@/hooks/useAuth'
import { getApiErrorMessage } from '@/lib/apiErrorMessage'
import { isHrmsSystemUser } from '@/lib/hrmsAccess'
import { isAuthOtpChallenge } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

const otpSchema = z.object({
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from email'),
})

type LoginForm = z.infer<typeof loginSchema>
type OtpForm = z.infer<typeof otpSchema>

const features = ['HR Management', 'Multi-Branch', 'Employee Lifecycle']

export function LoginPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [otpInfo, setOtpInfo] = useState<{
    challengeId: string
    message: string
  } | null>(null)
  const [resending, setResending] = useState(false)
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

  const {
    register: registerOtp,
    handleSubmit: handleOtpSubmit,
    formState: { errors: otpErrors, isSubmitting: otpSubmitting },
    reset: resetOtp,
  } = useForm<OtpForm>({
    resolver: zodResolver(otpSchema),
    defaultValues: { otp: '' },
  })

  const completeLogin = (accessToken: string, user: Parameters<typeof login>[1]) => {
    if (!isHrmsSystemUser(user)) {
      setError(
        'Employee accounts cannot sign in to HRMS. Use the Employee Portal.',
      )
      return
    }
    login(accessToken, user)
    navigate('/dashboard', { replace: true })
  }

  const onSubmit = async (data: LoginForm) => {
    setError('')
    try {
      const response = await authApi.login(data.email, data.password)
      if (isAuthOtpChallenge(response)) {
        setOtpInfo({
          challengeId: response.challengeId,
          message: response.message,
        })
        resetOtp({ otp: '' })
        return
      }
      completeLogin(response.access_token, response.user)
    } catch (err) {
      if (err instanceof Error && err.message === 'HRMS_ACCESS_DENIED') {
        setError(
          'Employee accounts cannot sign in to HRMS. Use the Employee Portal.',
        )
        return
      }
      setError(getApiErrorMessage(err, 'Invalid email or password'))
    }
  }

  const onVerifyOtp = async (data: OtpForm) => {
    if (!otpInfo) return
    setError('')
    try {
      const response = await authApi.verifyOtp(otpInfo.challengeId, data.otp)
      completeLogin(response.access_token, response.user)
    } catch (err) {
      setError(getApiErrorMessage(err, 'Invalid or expired OTP'))
    }
  }

  const onResendOtp = async () => {
    if (!otpInfo) return
    setError('')
    setResending(true)
    try {
      const response = await authApi.resendOtp(otpInfo.challengeId)
      setOtpInfo({
        challengeId: response.challengeId,
        message: response.message,
      })
      resetOtp({ otp: '' })
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not resend OTP'))
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col lg:flex-row">
      {/* Brand panel — compact on mobile, side panel on desktop */}
      <div className="flex flex-col justify-between bg-primary px-5 py-8 text-white sm:px-8 lg:w-[40%] lg:p-12">
        <div>
          <div className="mb-4 flex items-center gap-3 sm:mb-8 sm:gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-xl font-bold text-primary sm:h-16 sm:w-16 sm:text-2xl">
              Y
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold sm:text-3xl">YCDO</h1>
              <p className="truncate text-xs text-white/80 sm:text-sm">
                Youth Community Development Organization
              </p>
            </div>
          </div>
          <p className="text-base italic text-white/90 sm:text-lg">
            Donate Love, Money and Time
          </p>
          <div className="mt-2 h-1 w-16 rounded bg-accent" />
        </div>

        <ul className="mt-6 hidden space-y-3 lg:mt-0 lg:block">
          {features.map((item) => (
            <li key={item} className="flex items-center gap-2 text-white/90">
              <span className="text-accent">✓</span>
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-start justify-center bg-white px-4 py-8 sm:px-8 sm:py-10 lg:w-[60%] lg:items-center">
        <div className="w-full max-w-[400px]">
          <div className="mb-6 hidden justify-center lg:mb-8 lg:flex">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-white">
              Y
            </div>
          </div>

          {!otpInfo ? (
            <>
              <p className="text-center text-sm text-text-secondary">
                Welcome back
              </p>
              <h2 className="mt-1 text-center text-xl font-bold text-text-primary sm:text-2xl">
                Sign in to YCDO HRMS
              </h2>
              <p className="mt-2 text-center text-sm text-text-secondary">
                Manage your HR operations across all branches
              </p>

              <form
                onSubmit={handleSubmit(onSubmit)}
                className="mt-8 space-y-5"
              >
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@ycdo.org"
                    className="h-11 text-base"
                    autoComplete="email"
                    {...register('email')}
                  />
                  {errors.email && (
                    <p className="text-sm text-destructive">
                      {errors.email.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      className="h-11 text-base"
                      autoComplete="current-password"
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
                    <p className="text-sm text-destructive">
                      {errors.password.message}
                    </p>
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
                  className="h-11 w-full bg-primary hover:bg-primary-dark"
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
            </>
          ) : (
            <>
              <p className="text-center text-sm text-text-secondary">
                Super Admin verification
              </p>
              <h2 className="mt-1 text-center text-xl font-bold text-text-primary sm:text-2xl">
                Enter OTP
              </h2>
              <p className="mt-2 text-center text-sm text-text-secondary">
                {otpInfo.message}
              </p>

              <form
                onSubmit={handleOtpSubmit(onVerifyOtp)}
                className="mt-8 space-y-5"
              >
                <div className="space-y-2">
                  <Label htmlFor="otp">6-digit code</Label>
                  <Input
                    id="otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="••••••"
                    maxLength={6}
                    className="h-11 tracking-[0.35em] text-center text-lg"
                    {...registerOtp('otp')}
                  />
                  {otpErrors.otp && (
                    <p className="text-sm text-destructive">
                      {otpErrors.otp.message}
                    </p>
                  )}
                </div>

                {error && (
                  <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={otpSubmitting}
                  className="h-11 w-full bg-primary hover:bg-primary-dark"
                >
                  {otpSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    'Verify & Sign In'
                  )}
                </Button>

                <div className="flex items-center justify-between gap-2 text-sm">
                  <button
                    type="button"
                    className="text-text-secondary hover:text-text-primary"
                    onClick={() => {
                      setOtpInfo(null)
                      setError('')
                      resetOtp({ otp: '' })
                    }}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={resending}
                    className="text-primary hover:underline disabled:opacity-50"
                    onClick={onResendOtp}
                  >
                    {resending ? 'Sending…' : 'Resend code'}
                  </button>
                </div>
              </form>
            </>
          )}

          <p className="mt-10 text-center text-xs text-text-secondary">
            YCDO HRMS v1.0 · Powered by YCDO IT Team
          </p>
        </div>
      </div>
    </div>
  )
}
