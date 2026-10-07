import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { publicJobsApi, type JobPosting } from '../../api/endpoints/careers'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Input } from '../../components/ui/input'
import { MapPin, Briefcase, Calendar, Search } from 'lucide-react'

export default function JobsPublicPage() {
  const [jobs, setJobs] = useState<JobPosting[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  const user = (() => {
    try { return JSON.parse(localStorage.getItem('career_user') || 'null') } catch { return null }
  })()

  useEffect(() => {
    publicJobsApi.listJobs()
      .then(setJobs)
      .finally(() => setLoading(false))
  }, [])

  const filtered = jobs.filter(
    (j) =>
      j.title.toLowerCase().includes(search.toLowerCase()) ||
      (j.department || '').toLowerCase().includes(search.toLowerCase()) ||
      (j.location || '').toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">YCDO Careers</h1>
            <p className="text-sm text-gray-500">Join our team and make a difference</p>
          </div>
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <span className="text-sm text-gray-600">Hi, {user.fullName}</span>
                <Button variant="outline" size="sm" onClick={() => navigate('/jobs/my-applications')}>
                  My Applications
                </Button>
                <Button variant="ghost" size="sm" onClick={() => {
                  localStorage.removeItem('career_token')
                  localStorage.removeItem('career_user')
                  window.location.reload()
                }}>
                  Sign Out
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => navigate('/jobs/auth')}>
                Sign In / Register
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            className="pl-9"
            placeholder="Search by title, department, or location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-400">Loading opportunities...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            {search ? 'No jobs match your search.' : 'No open positions at this time.'}
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((job) => (
              <Link
                key={job.id}
                to={`/jobs/${job.id}`}
                className="block bg-white rounded-lg border hover:border-blue-400 hover:shadow-md transition-all p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-semibold text-gray-900 truncate">{job.title}</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                      {job.department && (
                        <span className="flex items-center gap-1">
                          <Briefcase className="h-3.5 w-3.5" />
                          {job.department}
                        </span>
                      )}
                      {job.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {job.location}
                        </span>
                      )}
                      {job.deadline && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          Deadline: {new Date(job.deadline).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {job.description && (
                      <p className="mt-2 text-sm text-gray-600 line-clamp-2">{job.description}</p>
                    )}
                  </div>
                  <Badge className="shrink-0 bg-green-100 text-green-700 border-0">Open</Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
