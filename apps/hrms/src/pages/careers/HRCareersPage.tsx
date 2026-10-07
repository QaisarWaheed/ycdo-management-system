import { useEffect, useState } from 'react'
import { hrCareersApi, type JobPosting } from '../../api/endpoints/careers'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Badge } from '../../components/ui/badge'
import { Plus, Pencil, Trash2, X, Briefcase, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const STATUS_LABELS = { DRAFT: 'Draft', OPEN: 'Open', CLOSED: 'Closed' }
const STATUS_COLORS = {
  DRAFT: 'bg-gray-100 text-gray-600',
  OPEN: 'bg-green-100 text-green-700',
  CLOSED: 'bg-red-100 text-red-600',
}

const emptyJob = (): Partial<JobPosting> => ({ title: '', department: '', location: '', description: '', requirements: '', deadline: '', status: 'OPEN' })

export default function HRCareersPage() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<JobPosting[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyJob())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const load = (status?: string) => {
    setLoading(true)
    hrCareersApi.listAllJobs(status || undefined)
      .then(setJobs)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const openCreate = () => { setForm(emptyJob()); setEditingId(null); setError(''); setModalOpen(true) }
  const openEdit = (job: JobPosting) => { setForm({ ...job, deadline: job.deadline ? job.deadline.slice(0, 10) : '' }); setEditingId(job.id); setError(''); setModalOpen(true) }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      if (editingId) {
        const updated = await hrCareersApi.updateJob(editingId, form)
        setJobs((j) => j.map((x) => x.id === editingId ? updated : x))
      } else {
        const created = await hrCareersApi.createJob(form)
        setJobs((j) => [created, ...j])
      }
      setModalOpen(false)
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this job posting?')) return
    await hrCareersApi.deleteJob(id)
    setJobs((j) => j.filter((x) => x.id !== id))
  }

  const set = (k: keyof JobPosting) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Postings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage career opportunities at YCDO</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/careers/applications')}>
            <Users className="h-4 w-4 mr-1" /> Applications
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> New Job
          </Button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {(['', 'OPEN', 'DRAFT', 'CLOSED'] as const).map((s) => (
          <button
            key={s}
            className={`px-3 py-1 text-sm rounded-full border transition-colors ${statusFilter === s ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}
            onClick={() => { setStatusFilter(s); load(s) }}
          >
            {s === '' ? 'All' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading...</div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16 text-gray-400">No job postings found.</div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div key={job.id} className="bg-white rounded-lg border p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-gray-900 truncate">{job.title}</h2>
                  <Badge className={`shrink-0 border-0 text-xs ${STATUS_COLORS[job.status]}`}>{STATUS_LABELS[job.status]}</Badge>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 mt-0.5">
                  {job.department && <span>{job.department}</span>}
                  {job.location && <span>· {job.location}</span>}
                  {job.deadline && <span>· Deadline: {new Date(job.deadline).toLocaleDateString()}</span>}
                  {job._count && <span className="flex items-center gap-1"><Briefcase className="h-3 w-3" /> {job._count.applications} applications</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => navigate(`/careers/applications?jobId=${job.id}`)}>
                  <Users className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openEdit(job)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-600" onClick={() => handleDelete(job.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="font-semibold text-lg">{editingId ? 'Edit Job' : 'New Job Posting'}</h2>
              <button onClick={() => setModalOpen(false)}><X className="h-5 w-5 text-gray-400" /></button>
            </div>
            <form onSubmit={handleSave} className="p-4 space-y-4">
              <div>
                <Label>Title *</Label>
                <Input className="mt-1" value={form.title} onChange={set('title')} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Department</Label><Input className="mt-1" value={form.department} onChange={set('department')} /></div>
                <div><Label>Location</Label><Input className="mt-1" value={form.location} onChange={set('location')} /></div>
              </div>
              <div>
                <Label>Description</Label>
                <Textarea className="mt-1" rows={4} value={form.description} onChange={set('description')} />
              </div>
              <div>
                <Label>Requirements</Label>
                <Textarea className="mt-1" rows={4} value={form.requirements} onChange={set('requirements')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Deadline</Label>
                  <Input className="mt-1" type="date" value={form.deadline as string} onChange={set('deadline')} />
                </div>
                <div>
                  <Label>Status</Label>
                  <select className="mt-1 w-full border rounded-md px-3 py-2 text-sm" value={form.status} onChange={set('status')}>
                    <option value="OPEN">Open</option>
                    <option value="DRAFT">Draft</option>
                    <option value="CLOSED">Closed</option>
                  </select>
                </div>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={saving}>{saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Job'}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
