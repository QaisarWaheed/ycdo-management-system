import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileCheck, Upload } from 'lucide-react'
import api from '@/api/axios'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'

/**
 * Req 13: print the appointment form, get it signed, scan it and upload it
 * here; the letter can be sent for approval only after this.
 */
export function SignedScanUploadButton({
  letterId,
  uploaded,
  onUploaded,
}: {
  letterId: string
  uploaded?: boolean
  onUploaded?: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const upload = async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    setBusy(true)
    try {
      await api.post(`/letters/${letterId}/signed-scan`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast({ title: 'Signed scan uploaded — you can now submit for approval' })
      queryClient.invalidateQueries({ queryKey: ['letters'] })
      onUploaded?.()
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message
      toast({ title: 'Upload failed', description: String(msg ?? 'Error'), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
          e.target.value = ''
        }}
      />
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => ref.current?.click()}>
        {uploaded ? <FileCheck className="mr-1 h-4 w-4 text-green-600" /> : <Upload className="mr-1 h-4 w-4" />}
        {uploaded ? 'Signed scan uploaded (replace)' : 'Upload signed scan'}
      </Button>
    </>
  )
}

/** Req 13: open the signed scan (approvers compare it with the digital letter). */
export function SignedScanViewButton({ letterId }: { letterId: string }) {
  const [busy, setBusy] = useState(false)
  const open = async () => {
    const tab = window.open('', '_blank')
    setBusy(true)
    try {
      const blob = await api.get<unknown, Blob>(`/letters/${letterId}/signed-scan`, { responseType: 'blob' })
      const url = URL.createObjectURL(blob)
      if (tab) tab.location.href = url
      else window.open(url, '_blank')
    } catch {
      tab?.close()
      toast({ title: 'No signed scan uploaded', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={open}>
      <FileCheck className="mr-1 h-4 w-4" />
      Signed scan
    </Button>
  )
}
