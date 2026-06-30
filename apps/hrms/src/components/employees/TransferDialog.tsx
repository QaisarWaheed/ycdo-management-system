import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { formatBranchLabel } from '@/lib/formatBranchLabel'

interface TransferDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  employeeId: string
  currentDesignation?: string
}

export function TransferDialog({
  open,
  onOpenChange,
  employeeId,
  currentDesignation = '',
}: TransferDialogProps) {
  const queryClient = useQueryClient()
  const [branchId, setBranchId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [designation, setDesignation] = useState(currentDesignation)
  const [changeType, setChangeType] = useState('TRANSFERRED')
  const [changeReason, setChangeReason] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')

  useEffect(() => {
    if (open) setDesignation(currentDesignation)
  }, [open, currentDesignation])

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
    enabled: open,
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', branchId],
    queryFn: () => departmentsApi.getAll({ branchId }),
    enabled: open && !!branchId,
  })

  const mutation = useMutation({
    mutationFn: () =>
      employeesApi.transfer(employeeId, {
        currentBranchId: branchId,
        currentDepartmentId: departmentId,
        currentDesignation: designation,
        changeType,
        changeReason,
        effectiveDate,
      }),
    onSuccess: () => {
      toast({ title: 'Employee transferred successfully' })
      queryClient.invalidateQueries({ queryKey: ['employee', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Transfer failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transfer Employee</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label>New Branch *</Label>
            <Select
              value={branchId}
              onValueChange={(v) => {
                setBranchId(v)
                setDepartmentId('')
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {formatBranchLabel(b)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>New Department *</Label>
            <Select
              value={departmentId}
              onValueChange={setDepartmentId}
              disabled={!branchId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>New Designation *</Label>
            <Input value={designation} onChange={(e) => setDesignation(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Change Type *</Label>
            <Select value={changeType} onValueChange={setChangeType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TRANSFERRED">Transferred</SelectItem>
                <SelectItem value="PROMOTED">Promoted</SelectItem>
                <SelectItem value="DEMOTED">Demoted</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Effective Date *</Label>
            <Input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={
              !branchId ||
              !departmentId ||
              !designation ||
              !changeReason ||
              !effectiveDate ||
              mutation.isPending
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Transferring...' : 'Transfer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
