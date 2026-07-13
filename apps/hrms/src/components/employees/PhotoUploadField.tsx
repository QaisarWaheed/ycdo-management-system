import { useEffect, useMemo, useRef } from 'react'
import { Camera, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PhotoUploadFieldProps {
  file: File | null
  onChange: (file: File | null) => void
  label?: string
  className?: string
}

export function PhotoUploadField({
  file,
  onChange,
  label = 'Employee Photo',
  className,
}: PhotoUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  )

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-full border-2 border-dashed border-border bg-muted">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Employee preview"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center text-text-secondary">
              <Camera className="h-8 w-8" />
              <span className="mt-1 text-[10px]">No photo</span>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark"
              onClick={() => inputRef.current?.click()}
            >
              {file ? 'Change Photo' : 'Upload Photo'}
            </button>
            {file && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                onClick={() => {
                  onChange(null)
                  if (inputRef.current) inputRef.current.value = ''
                }}
              >
                <X className="h-4 w-4" />
                Remove
              </button>
            )}
          </div>
          <p className="text-xs text-text-secondary">
            JPG or PNG, max 5 MB. Used for employee profile and face sync.
          </p>
          {file && (
            <p className="text-xs text-text-secondary">{file.name}</p>
          )}
        </div>
      </div>
    </div>
  )
}
