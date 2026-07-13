const API_BASE = import.meta.env.VITE_API_URL || 'http://187.127.115.103:3000'

export function resolveFileUrl(path?: string | null): string | null {
  if (!path) return null
  if (path.startsWith('http')) return path
  return `${API_BASE}${path}`
}
