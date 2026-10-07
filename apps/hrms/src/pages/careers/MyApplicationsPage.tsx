import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { applicantApi, type CareerApplication } from '../../api/endpoints/careers'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { ChevronLeft, Briefcase, MapPin } from 'lucide-react'

const STATUS_COLORS: Record<CareerApplication['status'], string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  REVIEWING: 'bg-blue-100 text-blue-700',
  SHORTLISTED: 'bg-purple-100 text-purple-700',
  REJECTED: 'bg-red-100 text-red-700',
  HIRED: 'bg-green-100 text-green-700',
}

export default function MyApplicationsPage() {
  const navigate = useNavigate()
  const [apps, setApps] = useState<CareerApplication[]>([])
  const [loading, setLoading] = useState(true)

  const user = (() => {
    try { return JSON.parse(localStorage.getItem('career_user') || 'null') } catch { return null }
  })()

  useEffect(() => {
    if (!user) { navigate('/jobs/auth', { state: { returnTo: '/jobs/my-applications' } }); return }
    applicantApi.myApplications()
      .then(setApps)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate('/jobs')} className="text-gray-500 hover:text-gray-700">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">My Applications</h1>
            {user && <p className="text-sm text-gray-500">{user.fullName} · {user.email}</p>}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              localStorage.removeItem('career_token')
              localStorage.removeItem('career_user')
              navigate('/jobs')
            }}
          >
            Sign Out
          </Button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center py-16 text-gray-400">Loading...</div>
        ) : apps.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 mb-4">You haven't applied for any positions yet.</p>
            <Button onClick={() => navigate('/jobs')}>Browse Jobs</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {apps.map((app) => (
              <div key={app.id} className="bg-white rounded-lg border p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-gray-900 truncate">{app.job.title}</h2>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-500 mt-1">
                      {app.job.department && <span className="flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" />{app.job.department}</span>}
                      {app.job.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{app.job.location}</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Applied {new Date(app.createdAt).toLocaleDateString()}</p>
                  </div>
                  <Badge className={`shrink-0 border-0 ${STATUS_COLORS[app.status]}`}>{app.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
