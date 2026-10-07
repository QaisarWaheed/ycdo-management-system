import careersApi from '../careersAxios'
import api from '../axios'

// ── Types ────────────────────────────────────────────────────────────────────

export interface JobPosting {
  id: string
  title: string
  department?: string
  location?: string
  description?: string
  requirements?: string
  deadline?: string
  status: 'DRAFT' | 'OPEN' | 'CLOSED'
  createdAt: string
  updatedAt: string
  _count?: { applications: number }
}

export interface Applicant {
  id: string
  fullName: string
  email: string
  phone?: string
}

export interface AcademicRecord {
  degree: string
  institution: string
  year?: string
  grade?: string
}

export interface Experience {
  organization: string
  position?: string
  from?: string
  to?: string
  responsibilities?: string
}

export interface CareerApplication {
  id: string
  status: 'PENDING' | 'REVIEWING' | 'SHORTLISTED' | 'REJECTED' | 'HIRED'
  fatherName?: string
  dateOfBirth?: string
  gender?: string
  cnic?: string
  address?: string
  city?: string
  academicRecords?: AcademicRecord[]
  experiences?: Experience[]
  coverLetter?: string
  createdAt: string
  updatedAt: string
  job: Pick<JobPosting, 'id' | 'title' | 'department' | 'location'>
  applicant: Applicant
}

// ── Public (no auth) ─────────────────────────────────────────────────────────

export const publicJobsApi = {
  listJobs: (): Promise<JobPosting[]> => careersApi.get('/careers/jobs'),
  getJob: (id: string): Promise<JobPosting> => careersApi.get(`/careers/jobs/${id}`),
}

// ── Applicant auth ────────────────────────────────────────────────────────────

export const applicantAuthApi = {
  register: (data: { fullName: string; email: string; password: string; phone?: string }): Promise<{ applicant: Applicant; token: string }> =>
    careersApi.post('/careers/auth/register', data),
  login: (data: { email: string; password: string }): Promise<{ applicant: Applicant; token: string }> =>
    careersApi.post('/careers/auth/login', data),
}

// ── Applicant actions (needs career_token) ────────────────────────────────────

export const applicantApi = {
  applyForJob: (jobId: string, data: Partial<Omit<CareerApplication, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'job' | 'applicant'>>): Promise<CareerApplication> =>
    careersApi.post(`/careers/jobs/${jobId}/apply`, data),
  myApplications: (): Promise<CareerApplication[]> =>
    careersApi.get('/careers/my-applications'),
}

// ── HR actions (needs hrms_token via regular axios) ───────────────────────────

export const hrCareersApi = {
  listAllJobs: (status?: string): Promise<JobPosting[]> =>
    api.get('/careers/admin/jobs', { params: status ? { status } : undefined }),
  createJob: (data: Partial<JobPosting>): Promise<JobPosting> =>
    api.post('/careers/admin/jobs', data),
  updateJob: (id: string, data: Partial<JobPosting>): Promise<JobPosting> =>
    api.patch(`/careers/admin/jobs/${id}`, data),
  deleteJob: (id: string): Promise<void> =>
    api.delete(`/careers/admin/jobs/${id}`),

  listApplications: (params?: { jobId?: string; status?: string }): Promise<CareerApplication[]> =>
    api.get('/careers/admin/applications', { params }),
  getApplication: (id: string): Promise<CareerApplication> =>
    api.get(`/careers/admin/applications/${id}`),
  updateApplicationStatus: (id: string, status: CareerApplication['status']): Promise<CareerApplication> =>
    api.patch(`/careers/admin/applications/${id}/status`, { status }),
}
