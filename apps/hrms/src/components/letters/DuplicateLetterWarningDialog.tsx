import { AlertTriangle } from 'lucide-react'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'

interface DuplicateLetterWarningDialogProps {
  open: boolean
  employeeName: string
  letterType: string
  date: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function DuplicateLetterWarningDialog({
  open,
  employeeName,
  letterType,
  date,
  loading,
  onConfirm,
  onCancel,
}: DuplicateLetterWarningDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      title="Duplicate Letter Warning"
      description={`A ${letterType.replace(/_/g, ' ')} letter was already sent to ${employeeName} on ${date}. Are you sure you want to send another one?`}
      confirmLabel="Send Anyway"
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}

export function DuplicateLetterWarningIcon() {
  return <AlertTriangle className="h-5 w-5 text-amber-500" />
}
