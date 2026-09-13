import axios from 'axios'

const api = axios.create({
  // Keep production portal builds functional even when the deployment does
  // not pass VITE_API_URL as a Docker build argument. Local development can
  // still override this with VITE_API_URL=http://localhost:3000.
  baseURL: import.meta.env.VITE_API_URL || 'https://hrms-api.ycdo.org.pk',
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('portal_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('portal_token')
      localStorage.removeItem('portal_user')
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

export default api
