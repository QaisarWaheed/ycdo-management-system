import { lettersApi } from '@/api/endpoints/letters'
import axios from 'axios'

async function messageFromBlob(blob: Blob): Promise<string | null> {
  if (!blob.type?.includes('application/json') && blob.type !== '') {
    // Nest often returns application/json; empty type can still be JSON text.
    const peek = await blob.slice(0, 1).text()
    if (peek !== '{' && peek !== '[') return null
  }
  try {
    const text = await blob.text()
    const parsed = JSON.parse(text) as { message?: string | string[] }
    if (!parsed.message) return null
    return Array.isArray(parsed.message)
      ? parsed.message.join(', ')
      : parsed.message
  } catch {
    return null
  }
}

/** Download a letter PDF; regenerates server-side if the file was lost. */
export async function downloadLetterPdf(
  letterId: string,
  suggestedName?: string,
): Promise<void> {
  let blob: Blob
  try {
    blob = await lettersApi.getPdf(letterId)
  } catch (err) {
    let message = 'File unavailable — please reissue'
    if (axios.isAxiosError(err) && err.response?.data instanceof Blob) {
      message = (await messageFromBlob(err.response.data)) ?? message
    } else if (err instanceof Error && err.message) {
      message = err.message
    }
    throw new Error(message)
  }

  // Axios success path can still return a JSON error body as a Blob
  // if a proxy rewrites the status.
  if (blob.type?.includes('application/json')) {
    const message =
      (await messageFromBlob(blob)) ?? 'File unavailable — please reissue'
    throw new Error(message)
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName ?? `letter-${letterId.slice(0, 8)}.pdf`
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Keep the blob URL briefly so the browser can start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
