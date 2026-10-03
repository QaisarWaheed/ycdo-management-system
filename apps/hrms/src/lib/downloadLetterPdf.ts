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
export function downloadLetterPdf(
  letterId: string,
  suggestedName?: string,
): Promise<void> {
  return saveBlobFrom(
    () => lettersApi.getPdf(letterId),
    suggestedName ?? `letter-${letterId.slice(0, 8)}.pdf`,
    'File unavailable — please reissue',
  )
}

/** Fetch an authenticated blob and return it, turning JSON error bodies into Errors. */
export async function fetchBlob(
  fetcher: () => Promise<Blob>,
  fallbackMessage = 'File unavailable',
): Promise<Blob> {
  let blob: Blob
  try {
    blob = await fetcher()
  } catch (err) {
    let message = fallbackMessage
    if (axios.isAxiosError(err) && err.response?.data instanceof Blob) {
      message = (await messageFromBlob(err.response.data)) ?? message
    } else if (err instanceof Error && err.message) {
      message = err.message
    }
    throw new Error(message, { cause: err })
  }

  // Axios success path can still return a JSON error body as a Blob
  // if a proxy rewrites the status.
  if (blob.type?.includes('application/json')) {
    throw new Error((await messageFromBlob(blob)) ?? fallbackMessage)
  }
  return blob
}

/** Fetch an authenticated blob and save it under `fileName`. */
export async function saveBlobFrom(
  fetcher: () => Promise<Blob>,
  fileName: string,
  fallbackMessage?: string,
): Promise<void> {
  const blob = await fetchBlob(fetcher, fallbackMessage)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Keep the blob URL briefly so the browser can start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
