import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { hrCareersApi, type CareerApplication } from '../../api/endpoints/careers'
import { Badge } from '../../components/ui/badge'
import { ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react'

type AppStatus = CareerApplication['status']

const STATUS_COLORS: Record<AppStatus, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  REVIEWING: 'bg-blue-100 text-blue-700',
  SHORTLISTED: 'bg-purple-100 text-purple-700',
  REJECTED: 'bg-red-100 text-red-700',
  HIRED: 'bg-green-100 text-green-700',
}

const ALL_STATUSES: AppStatus[] = ['PENDING', 'REVIEWING', 'SHORTLISTED', 'REJECTED', 'HIRED']

export default function HRApplicationsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const jobIdFilter = searchParams.get('jobId') || ''

  const [apps, setApps] = useState<CareerApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<AppStatus | ''>('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    hrCareersApi.listApplications({
      jobId: jobIdFilter || undefined,
      status: statusFilter || undefined,
    })
      .then(setApps)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [statusFilter, jobIdFilter])

  const handleStatusChange = async (id: string, status: AppStatus) => {
    setUpdatingId(id)
    try {
      const updated = await hrCareersApi.updateApplicationStatus(id, status)
      setApps((a) => a.map((x) => x.id === id ? updated : x))
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/careers')} className="text-gray-500 hover:text-gray-700">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Career Applications</h1>
          {jobIdFilter && <p className="text-sm text-gray-500">Filtered by job</p>}
        </div>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(['', ...ALL_STATUSES] as const).map((s) => (
          <button
            key={s}
            className={`px-3 py-1 text-sm rounded-full border transition-colors ${statusFilter === s ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}
            onClick={() => setStatusFilter(s as AppStatus | '')}
          >
            {s === '' ? 'All' : s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading...</div>
      ) : apps.length === 0 ? (
        <div className="text-center py-16 text-gray-400">No applications found.</div>
      ) : (
        <div className="space-y-3">
          {apps.map((app) => (
            <div key={app.id} className="bg-white rounded-lg border overflow-hidden">
              <div
                className="p-4 flex items-center gap-4 cursor-pointer hover:bg-gray-50"
                onClick={() => setExpandedId(expandedId === app.id ? null : app.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{app.applicant.fullName}</span>
                    <span className="text-sm text-gray-400">{app.applicant.email}</span>
                    <Badge className={`border-0 text-xs ${STATUS_COLORS[app.status]}`}>{app.status}</Badge>
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    {app.job.title}{app.job.department ? ` · ${app.job.department}` : ''}
                    <span className="ml-3 text-xs text-gray-400">{new Date(app.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    className="text-sm border rounded-md px-2 py-1"
                    value={app.status}
                    disabled={updatingId === app.id}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => handleStatusChange(app.id, e.target.value as AppStatus)}
                  >
                    {ALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {expandedId === app.id ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                </div>
              </div>

              {expandedId === app.id && (
                <div className="border-t px-4 pb-4 pt-3 space-y-4 text-sm">
                  {/* BIO */}
                  <div>
                    <h3 className="font-medium text-gray-700 mb-2">Personal Information</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-gray-600">
                      {app.fatherName && <div><span className="text-gray-400">Father:</span> {app.fatherName}</div>}
                      {app.dateOfBirth && <div><span className="text-gray-400">DOB:</span> {new Date(app.dateOfBirth).toLocaleDateString()}</div>}
                      {app.gender && <div><span className="text-gray-400">Gender:</span> {app.gender}</div>}
                      {app.cnic && <div><span className="text-gray-400">CNIC:</span> {app.cnic}</div>}
                      {app.city && <div><span className="text-gray-400">City:</span> {app.city}</div>}
                      {app.address && <div className="col-span-2"><span className="text-gray-400">Address:</span> {app.address}</div>}
                      {app.applicant.phone && <div><span className="text-gray-400">Phone:</span> {app.applicant.phone}</div>}
                    </div>
                  </div>

                  {/* Academics */}
                  {app.academicRecords && (app.academicRecords as any[]).length > 0 && (
                    <div>
                      <h3 className="font-medium text-gray-700 mb-2">Academic Records</h3>
                      <div className="space-y-1">
                        {(app.academicRecords as any[]).map((ac, i) => (
                          <div key={i} className="text-gray-600">
                            <span className="font-medium">{ac.degree}</span> — {ac.institution}
                            {ac.year && ` (${ac.year})`}
                            {ac.grade && ` · GPA: ${ac.grade}`}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Experience */}
                  {app.experiences && (app.experiences as any[]).length > 0 && (
                    <div>
                      <h3 className="font-medium text-gray-700 mb-2">Work Experience</h3>
                      <div className="space-y-2">
                        {(app.experiences as any[]).map((exp, i) => (
                          <div key={i} className="text-gray-600">
                            <span className="font-medium">{exp.organization}</span>
                            {exp.position && ` — ${exp.position}`}
                            {(exp.from || exp.to) && <span className="text-gray-400 ml-1">({exp.from} – {exp.to || 'Present'})</span>}
                            {exp.responsibilities && <p className="text-gray-500 mt-0.5">{exp.responsibilities}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Cover Letter */}
                  {app.coverLetter && (
                    <div>
                      <h3 className="font-medium text-gray-700 mb-1">Cover Letter</h3>
                      <p className="text-gray-600 whitespace-pre-wrap">{app.coverLetter}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
