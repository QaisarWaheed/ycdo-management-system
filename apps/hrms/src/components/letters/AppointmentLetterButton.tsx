import { useState } from 'react'
import { FileText } from 'lucide-react'
import api from '@/api/axios'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'

/** Req 14: open the employee's appointment letter (PDF) in a new tab. */
export function AppointmentLetterButton({ employeeId, size = 'sm' }: { employeeId?: string | null; size?: 'sm' | 'default' }) {
  const [busy, setBusy] = useState(false)
  if (!employeeId) return null
  const open = async () => {
    // Open the tab first so the browser does not block it as a pop-up.
    const tab = window.open('', '_blank')
    setBusy(true)
    try {
      const blob = await api.get<unknown, Blob>(`/letters/appointment/${employeeId}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(blob)
      if (tab) tab.location.href = url
      else window.open(url, '_blank')
    } catch {
      tab?.close()
      toast({ title: 'No appointment letter found for this employee', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button type="button" variant="outline" size={size} disabled={busy} onClick={open}>
      <FileText className="mr-1 h-4 w-4" />
      Appointment letter
    </Button>
  )
}
