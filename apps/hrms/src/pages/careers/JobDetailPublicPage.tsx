import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { publicJobsApi, applicantApi, type JobPosting, type AcademicRecord, type Experience } from '../../api/endpoints/careers'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Badge } from '../../components/ui/badge'
import { MapPin, Briefcase, Calendar, Plus, Trash2, ChevronLeft } from 'lucide-react'

const emptyAcademic = (): AcademicRecord => ({ degree: '', institution: '', year: '', grade: '' })
const emptyExp = (): Experience => ({ organization: '', position: '', from: '', to: '', responsibilities: '' })

export default function JobDetailPublicPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [job, setJob] = useState<JobPosting | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const user = (() => {
    try { return JSON.parse(localStorage.getItem('career_user') || 'null') } catch { return null }
  })()

  const [bio, setBio] = useState({ fatherName: '', dateOfBirth: '', gender: '', cnic: '', address: '', city: '' })
  const [academics, setAcademics] = useState<AcademicRecord[]>([emptyAcademic()])
  const [experiences, setExperiences] = useState<Experience[]>([])
  const [coverLetter, setCoverLetter] = useState('')

  useEffect(() => {
    if (!id) return
    publicJobsApi.getJob(id)
      .then(setJob)
      .catch(() => navigate('/jobs'))
      .finally(() => setLoading(false))
  }, [id])

  const handleApplyClick = () => {
    if (!user) {
      navigate('/jobs/auth', { state: { returnTo: `/jobs/${id}` } })
      return
    }
    setShowForm(true)
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await applicantApi.applyForJob(id!, {
        ...bio,
        academicRecords: academics.filter((a) => a.degree && a.institution),
        experiences: experiences.filter((x) => x.organization),
        coverLetter,
      })
      setSubmitted(true)
      setShowForm(false)
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to submit application')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">Loading...</div>
  if (!job) return null

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate('/jobs')} className="text-gray-500 hover:text-gray-700">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{job.title}</h1>
            <div className="flex items-center gap-3 text-sm text-gray-500 mt-0.5">
              {job.department && <span className="flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" />{job.department}</span>}
              {job.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{job.location}</span>}
              {job.deadline && <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />Deadline: {new Date(job.deadline).toLocaleDateString()}</span>}
            </div>
          </div>
          <Badge className="ml-auto bg-green-100 text-green-700 border-0">Open</Badge>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Job details */}
        {job.description && (
          <div className="bg-white rounded-lg border p-5">
            <h2 className="font-semibold mb-2">About the Role</h2>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{job.description}</p>
          </div>
        )}
        {job.requirements && (
          <div className="bg-white rounded-lg border p-5">
            <h2 className="font-semibold mb-2">Requirements</h2>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{job.requirements}</p>
          </div>
        )}

        {submitted ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
            <p className="text-green-700 font-semibold text-lg">Application Submitted!</p>
            <p className="text-green-600 text-sm mt-1">HR will review your application and get back to you.</p>
            <Button className="mt-4" variant="outline" onClick={() => navigate('/jobs/my-applications')}>View My Applications</Button>
          </div>
        ) : !showForm ? (
          <div className="text-center py-4">
            <Button size="lg" onClick={handleApplyClick}>Apply for this Position</Button>
            {!user && <p className="text-sm text-gray-400 mt-2">You'll be asked to sign in or register first</p>}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* BIO */}
            <div className="bg-white rounded-lg border p-5 space-y-4">
              <h2 className="font-semibold text-gray-800">Personal Information</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><Label>Father Name</Label><Input className="mt-1" value={bio.fatherName} onChange={(e) => setBio((b) => ({ ...b, fatherName: e.target.value }))} /></div>
                <div><Label>Date of Birth</Label><Input className="mt-1" type="date" value={bio.dateOfBirth} onChange={(e) => setBio((b) => ({ ...b, dateOfBirth: e.target.value }))} /></div>
                <div>
                  <Label>Gender</Label>
                  <select className="mt-1 w-full border rounded-md px-3 py-2 text-sm" value={bio.gender} onChange={(e) => setBio((b) => ({ ...b, gender: e.target.value }))}>
                    <option value="">Select</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div><Label>CNIC</Label><Input className="mt-1" placeholder="XXXXX-XXXXXXX-X" value={bio.cnic} onChange={(e) => setBio((b) => ({ ...b, cnic: e.target.value }))} /></div>
                <div><Label>City</Label><Input className="mt-1" value={bio.city} onChange={(e) => setBio((b) => ({ ...b, city: e.target.value }))} /></div>
                <div className="sm:col-span-2"><Label>Address</Label><Input className="mt-1" value={bio.address} onChange={(e) => setBio((b) => ({ ...b, address: e.target.value }))} /></div>
              </div>
            </div>

            {/* Academics */}
            <div className="bg-white rounded-lg border p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-800">Academic Records</h2>
                <Button type="button" variant="outline" size="sm" onClick={() => setAcademics((a) => [...a, emptyAcademic()])}>
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
              {academics.map((ac, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-2 gap-3 border rounded-md p-3 relative">
                  {academics.length > 1 && (
                    <button type="button" className="absolute top-2 right-2 text-red-400 hover:text-red-600" onClick={() => setAcademics((a) => a.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <div><Label>Degree *</Label><Input className="mt-1" value={ac.degree} onChange={(e) => setAcademics((a) => a.map((x, j) => j === i ? { ...x, degree: e.target.value } : x))} /></div>
                  <div><Label>Institution *</Label><Input className="mt-1" value={ac.institution} onChange={(e) => setAcademics((a) => a.map((x, j) => j === i ? { ...x, institution: e.target.value } : x))} /></div>
                  <div><Label>Year</Label><Input className="mt-1" placeholder="e.g. 2020" value={ac.year} onChange={(e) => setAcademics((a) => a.map((x, j) => j === i ? { ...x, year: e.target.value } : x))} /></div>
                  <div><Label>Grade / GPA</Label><Input className="mt-1" value={ac.grade} onChange={(e) => setAcademics((a) => a.map((x, j) => j === i ? { ...x, grade: e.target.value } : x))} /></div>
                </div>
              ))}
            </div>

            {/* Experience */}
            <div className="bg-white rounded-lg border p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-800">Work Experience <span className="text-gray-400 text-sm font-normal">(optional)</span></h2>
                <Button type="button" variant="outline" size="sm" onClick={() => setExperiences((x) => [...x, emptyExp()])}>
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
              {experiences.map((exp, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-2 gap-3 border rounded-md p-3 relative">
                  <button type="button" className="absolute top-2 right-2 text-red-400 hover:text-red-600" onClick={() => setExperiences((x) => x.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <div><Label>Organization *</Label><Input className="mt-1" value={exp.organization} onChange={(e) => setExperiences((x) => x.map((v, j) => j === i ? { ...v, organization: e.target.value } : v))} /></div>
                  <div><Label>Position</Label><Input className="mt-1" value={exp.position} onChange={(e) => setExperiences((x) => x.map((v, j) => j === i ? { ...v, position: e.target.value } : v))} /></div>
                  <div><Label>From</Label><Input className="mt-1" type="month" value={exp.from} onChange={(e) => setExperiences((x) => x.map((v, j) => j === i ? { ...v, from: e.target.value } : v))} /></div>
                  <div><Label>To</Label><Input className="mt-1" type="month" value={exp.to} onChange={(e) => setExperiences((x) => x.map((v, j) => j === i ? { ...v, to: e.target.value } : v))} /></div>
                  <div className="sm:col-span-2"><Label>Responsibilities</Label><Textarea className="mt-1" value={exp.responsibilities} onChange={(e) => setExperiences((x) => x.map((v, j) => j === i ? { ...v, responsibilities: e.target.value } : v))} /></div>
                </div>
              ))}
              {experiences.length === 0 && <p className="text-sm text-gray-400 text-center py-2">No experience entries added</p>}
            </div>

            {/* Cover Letter */}
            <div className="bg-white rounded-lg border p-5">
              <Label>Cover Letter <span className="text-gray-400 font-normal">(optional)</span></Label>
              <Textarea className="mt-2" rows={5} placeholder="Tell us why you're a great fit..." value={coverLetter} onChange={(e) => setCoverLetter(e.target.value)} />
            </div>

            {error && <p className="text-sm text-red-500 text-center">{error}</p>}

            <div className="flex gap-3 justify-end">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? 'Submitting...' : 'Submit Application'}</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
