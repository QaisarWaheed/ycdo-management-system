import axios from 'axios'

// Separate axios instance for the careers/applicant portal.
// Uses career_token (not hrms_token) and redirects to /jobs/auth on 401.
const careersApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://187.127.115.103:3000',
  headers: { 'Content-Type': 'application/json' },
})

careersApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('career_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

careersApi.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('career_token')
      localStorage.removeItem('career_user')
      if (!window.location.pathname.startsWith('/jobs/auth')) {
        window.location.href = '/jobs/auth'
      }
    }
    return Promise.reject(error)
  },
)

export default careersApi
