const API_BASE = import.meta.env.VITE_API_URL || 'http://187.127.115.103:3000'

/** Already-absolute sources (including local object URLs) must be left alone. */
const ABSOLUTE_PREFIXES = ['http://', 'https://', 'blob:', 'data:', '//']

export function resolveFileUrl(path?: string | null): string | null {
  if (!path) return null
  if (ABSOLUTE_PREFIXES.some((prefix) => path.startsWith(prefix))) return path
  return `${API_BASE}${path}`
}
