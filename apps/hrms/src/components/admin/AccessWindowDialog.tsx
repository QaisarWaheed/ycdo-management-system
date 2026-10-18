import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import api from '@/api/axios'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'

type ApiError = { response?: { data?: { message?: string | string[] } } }
const local = (iso?: string | null) => (iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : '')
const EXEMPT = ['CHAIRMAN', 'PRESIDENT', 'FOUNDER', 'SUPER_ADMIN']

/** Req 20: label for the Login Access table. */
export function accessWindowLabel(r: { role: string; accessFrom?: string | null; accessUntil?: string | null }) {
  if (EXEMPT.includes(r.role)) return null
  const now = Date.now()
  if (r.accessUntil && new Date(r.accessUntil).getTime() < now) return { text: 'Access expired', expired: true }
  if (r.accessFrom && new Date(r.accessFrom).getTime() > now)
    return { text: `Starts ${format(new Date(r.accessFrom), 'dd/MM/yyyy HH:mm')}`, expired: true }
  if (r.accessUntil) return { text: `Until ${format(new Date(r.accessUntil), 'dd/MM/yyyy HH:mm')}`, expired: false }
  return null
}

/**
 * Req 20: the login works only from → until; after "until" it stops by
 * itself, also for a session already open. Executives are exempt.
 */
export function AccessWindowDialog({
  user,
  onClose,
}: {
  user: { id: string; email: string; role: string; accessFrom?: string | null; accessUntil?: string | null }
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [from, setFrom] = useState(local(user.accessFrom))
  const [until, setUntil] = useState(local(user.accessUntil))
  const exempt = EXEMPT.includes(user.role)
  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/user-access/${user.id}/access-window`, {
        accessFrom: from ? new Date(from).toISOString() : null,
        accessUntil: until ? new Date(until).toISOString() : null,
      }),
    onSuccess: () => {
      toast({ title: 'Access period saved' })
      queryClient.invalidateQueries({ queryKey: ['user-access'] })
      onClose()
    },
    onError: (err: ApiError) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Could not save',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Access period · {user.email}</DialogTitle>
        </DialogHeader>
        {exempt ? (
          <p className="text-sm text-muted-foreground">Executive logins are never limited by an access period.</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="access-from">From (date and time)</Label>
              <Input id="access-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="access-until">Until (date and time)</Label>
              <Input id="access-until" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Leave empty for no limit. After &quot;until&quot; the login stops working by itself, also if the user
              is already logged in.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {!exempt ? (
            <Button disabled={mutation.isPending || (!!from && !!until && until <= from)} onClick={() => mutation.mutate()}>
              Save
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
