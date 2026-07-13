import { FileText, ImageIcon } from 'lucide-react'
import { resolveFileUrl } from '@/lib/resolveFileUrl'
import { cn } from '@/lib/utils'

export function PhysicalFormViewer({
  url,
  mimeType,
  fileName,
  className,
}: {
  url?: string | null
  mimeType?: string | null
  fileName?: string | null
  className?: string
}) {
  const resolved = resolveFileUrl(url)
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
    resolved.toLowerCase().includes('.pdf')

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
