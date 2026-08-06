export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const message = (
      err as { response?: { data?: { message?: string | string[] } } }
    ).response?.data?.message
    if (typeof message === 'string') return message
    if (Array.isArray(message) && message[0]) return message[0]
  }
  if (
    err &&
    typeof err === 'object' &&
    'isAxiosError' in err &&
    (err as { response?: unknown }).response == null
  ) {
    return 'Cannot reach the server. Check your connection and try again.'
  }
  return fallback
}
