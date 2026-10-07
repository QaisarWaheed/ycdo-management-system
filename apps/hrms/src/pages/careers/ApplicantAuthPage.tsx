import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { applicantAuthApi } from '../../api/endpoints/careers'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'

export default function ApplicantAuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [form, setForm] = useState({ fullName: '', email: '', password: '', phone: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = (location.state as any)?.returnTo || '/jobs'

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = mode === 'login'
        ? await applicantAuthApi.login({ email: form.email, password: form.password })
        : await applicantAuthApi.register(form)
      localStorage.setItem('career_token', res.token)
      localStorage.setItem('career_user', JSON.stringify(res.applicant))
      navigate(returnTo)
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900">YCDO Careers</h1>
          <p className="text-sm text-gray-500 mt-1">
            {mode === 'login' ? 'Sign in to apply for jobs' : 'Create your applicant account'}
          </p>
        </div>

        <div className="bg-white rounded-xl border shadow-sm p-6">
          <div className="flex rounded-lg border overflow-hidden mb-5">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  mode === m ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
                onClick={() => { setMode(m); setError('') }}
              >
                {m === 'login' ? 'Sign In' : 'Register'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <Label>Full Name *</Label>
                  <Input className="mt-1" value={form.fullName} onChange={set('fullName')} required />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input className="mt-1" value={form.phone} onChange={set('phone')} placeholder="+92..." />
                </div>
              </>
            )}
            <div>
              <Label>Email *</Label>
              <Input className="mt-1" type="email" value={form.email} onChange={set('email')} required />
            </div>
            <div>
              <Label>Password *</Label>
              <Input className="mt-1" type="password" value={form.password} onChange={set('password')} required minLength={6} />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-sm text-gray-500">
          <button className="text-blue-600 hover:underline" onClick={() => navigate('/jobs')}>
            ← Back to job listings
          </button>
        </p>
      </div>
    </div>
  )
}
