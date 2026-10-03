import { useEffect, useState } from 'react'
import { FileText, ImageIcon, Loader2 } from 'lucide-react'
import { employeeOnboardingApi } from '@/api/endpoints/employeeOnboarding'
import { fetchBlob } from '@/lib/downloadLetterPdf'
import { cn } from '@/lib/utils'

/** Scanned paper form. The file is private, so it is fetched with the login token. */
export function PhysicalFormViewer({
  approvalId,
  url,
  mimeType,
  fileName,
  className,
}: {
  approvalId?: string
  url?: string | null
  mimeType?: string | null
  fileName?: string | null
  className?: string
}) {
  // Keyed by approval id so a stale file never shows for another record.
  const [loaded, setLoaded] = useState<{
    id: string
    src?: string
    error?: string
  } | null>(null)

  useEffect(() => {
    if (!url || !approvalId) return
    let objectUrl: string | null = null
    let cancelled = false
    fetchBlob(() => employeeOnboardingApi.getPhysicalForm(approvalId))
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setLoaded({ id: approvalId, src: objectUrl })
      })
      .catch(
        (err: Error) =>
          !cancelled && setLoaded({ id: approvalId, error: err.message }),
      )
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [approvalId, url])

  const current = loaded?.id === approvalId ? loaded : null
  const resolved = current?.src ?? null

  if (url && approvalId && !resolved) {
    return (
      <div
        className={cn(
          'flex min-h-[320px] items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-600',
          className,
        )}
      >
        {current?.error ?? <Loader2 className="h-6 w-6 animate-spin" />}
      </div>
    )
  }

  if (!resolved) {
    return (
      <div
        className={cn(
          'flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-amber-300 bg-amber-50 px-6 text-center',
          className,
        )}
      >
        <FileText className="mb-2 h-10 w-10 text-amber-600" />
        <p className="font-medium text-amber-900">No physical form attached</p>
        <p className="mt-1 text-sm text-amber-800/80">
          HR did not upload a scan/photo of the filled paper form.
        </p>
      </div>
    )
  }

  const isPdf =
    mimeType === 'application/pdf' ||
    fileName?.toLowerCase().endsWith('.pdf') ||
    url?.toLowerCase().endsWith('.pdf')

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          {isPdf ? (
            <FileText className="h-4 w-4 shrink-0 text-slate-600" />
          ) : (
            <ImageIcon className="h-4 w-4 shrink-0 text-slate-600" />
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Physical form (scan / photo)
            </p>
            <p className="truncate text-sm text-slate-800">
              {fileName || 'Uploaded attachment'}
            </p>
          </div>
        </div>
        <a
          href={resolved}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-sm font-medium text-teal-700 hover:underline"
        >
          Open
        </a>
      </div>
      <div className="bg-slate-100 p-3">
        {isPdf ? (
          <iframe
            title="Physical employee form"
            src={resolved}
            className="h-[70vh] min-h-[420px] w-full rounded-lg border border-slate-200 bg-white"
          />
        ) : (
          <img
            src={resolved}
            alt={fileName || 'Physical employee form'}
            className="mx-auto max-h-[70vh] w-auto max-w-full rounded-lg object-contain"
          />
        )}
      </div>
    </div>
  )
}
