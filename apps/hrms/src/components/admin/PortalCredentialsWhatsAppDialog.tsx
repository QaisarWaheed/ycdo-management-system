import { useMemo, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import type { PortalWhatsAppSharesResponse } from '@/api/endpoints/userPasswords'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function PortalCredentialsWhatsAppDialog({
  open,
  onOpenChange,
  data,
  isLoading,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: PortalWhatsAppSharesResponse | undefined
  isLoading: boolean
}) {
  const [index, setIndex] = useState(0)
  const readyItems = useMemo(
    () => (data?.items ?? []).filter((i) => i.ready && i.waUrl),
    [data],
  )
  const skipped = useMemo(
    () => (data?.items ?? []).filter((i) => !i.ready),
    [data],
  )

  const openCurrent = () => {
    const item = readyItems[index]
    if (!item?.waUrl) return
    window.open(item.waUrl, '_blank', 'noopener,noreferrer')
  }

  const openAndAdvance = () => {
    openCurrent()
    if (index < readyItems.length - 1) {
      setIndex((i) => i + 1)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setIndex(0)
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send portal credentials via WhatsApp</DialogTitle>
        </DialogHeader>

        {isLoading || !data ? (
          <p className="py-8 text-center text-sm text-text-secondary">
            Preparing WhatsApp links…
          </p>
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-text-secondary">
              Portal login:{' '}
              <span className="font-mono text-text-primary">{data.portalUrl}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{data.total} total</Badge>
              <Badge className="bg-green-600 text-white hover:bg-green-600">
                {data.ready} ready
              </Badge>
              <Badge
                variant="outline"
                className="border-amber-300 text-amber-800"
              >
                {data.skipped} skipped
              </Badge>
            </div>

            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
              WhatsApp Web opens one chat at a time with a prefilled message
              (email + password). Click <strong>Open WhatsApp</strong> for each
              employee, then send in WhatsApp. Browsers block opening many tabs
              at once.
            </p>

            {readyItems.length === 0 && (
              <p className="py-4 text-center text-text-secondary">
                No ready shares. Employees need a valid phone number and a
                stored portal password.
              </p>
            )}

            {readyItems.length > 0 && (
              <div className="space-y-3 rounded-lg border border-border p-4">
                <p className="font-medium">
                  Ready {index + 1} of {readyItems.length}
                </p>
                <p>
                  <span className="text-text-secondary">Employee: </span>
                  {readyItems[index]?.employeeName}
                  {readyItems[index]?.employeeCode
                    ? ` (${readyItems[index].employeeCode})`
                    : ''}
                </p>
                <p>
                  <span className="text-text-secondary">Phone: </span>
                  {readyItems[index]?.phone ?? readyItems[index]?.phoneE164}
                </p>
                <p className="font-mono text-xs">
                  {readyItems[index]?.email} / {readyItems[index]?.password}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    className="bg-primary hover:bg-primary-dark"
                    onClick={openAndAdvance}
                  >
                    <MessageCircle className="mr-2 h-4 w-4" />
                    Open WhatsApp
                    {index < readyItems.length - 1 ? ' & next' : ''}
                  </Button>
                  {index > 0 && (
                    <Button
                      variant="outline"
                      onClick={() => setIndex((i) => i - 1)}
                    >
                      Previous
                    </Button>
                  )}
                  {index < readyItems.length - 1 && (
                    <Button
                      variant="outline"
                      onClick={() => setIndex((i) => i + 1)}
                    >
                      Skip
                    </Button>
                  )}
                </div>
              </div>
            )}

            {skipped.length > 0 && (
              <div className="space-y-2">
                <p className="font-medium text-amber-800">
                  Skipped ({skipped.length})
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-text-secondary">
                  {skipped.map((item) => (
                    <li key={item.userId}>
                      {item.employeeName}
                      {item.employeeCode ? ` (${item.employeeCode})` : ''}:{' '}
                      {item.skipReason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
