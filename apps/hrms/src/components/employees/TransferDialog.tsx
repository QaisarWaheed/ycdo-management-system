import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { designationsApi } from '@/api/endpoints/designations'
import { employeesApi } from '@/api/endpoints/employees'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DateInput } from '@/components/common/DateInput'
import { SearchableSelect } from '@/components/common/SearchableSelect'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { findDepartmentByName } from '@/lib/inlineMasterData'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import {
  CHANGE_TYPE_OPTIONS,
  changeTypeToLabel,
  labelToChangeType,
} from '@/lib/searchableSelectOptions'

interface TransferDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  employeeId: string
  currentDesignation?: string | null
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
  const [designation, setDesignation] = useState(currentDesignation ?? '')
  const [changeType, setChangeType] = useState('TRANSFERRED')
  const [changeReason, setChangeReason] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')

  useEffect(() => {
    if (open) setDesignation(currentDesignation ?? '')
  }, [open, currentDesignation])

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
    enabled: open,
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll(),
    enabled: open,
  })

  const selectedDepartment = departments.find((d) => d.id === departmentId)

  const designationParams = useMemo(() => {
    if (!selectedDepartment) return undefined
    return { department: selectedDepartment.name }
  }, [selectedDepartment])

  const { data: designations = [] } = useQuery({
    queryKey: ['designations', designationParams],
    queryFn: () => designationsApi.getAll(designationParams),
    enabled: open && !!departmentId,
  })

  const departmentOptions = useMemo(
    () => departments.map((d) => d.name),
    [departments],
  )

  const designationOptions = useMemo(
    () =>
      [...new Set(designations.map((d: { title: string }) => d.title))].sort(),
    [designations],
  )

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
          <SearchableSelect
            label="New Branch *"
            options={branches.map((b) => formatBranchLabel(b))}
            value={
              branches.find((b) => b.id === branchId)
                ? formatBranchLabel(branches.find((b) => b.id === branchId)!)
                : ''
            }
            onChange={(label) => {
              const branch = branches.find((b) => formatBranchLabel(b) === label)
              if (!branch) return
              setBranchId(branch.id)
              setDepartmentId('')
            }}
            placeholder="Search branch..."
          />

          <SearchableSelect
            label="New Department *"
            options={departmentOptions}
            value={selectedDepartment?.name ?? ''}
            onChange={(name) => {
              const dept = findDepartmentByName(departments, name)
              if (dept) {
                setDepartmentId(dept.id)
                setDesignation('')
              }
            }}
            placeholder="Search department..."
            disabled={!branchId}
          />

          <SearchableSelect
            label="New Designation *"
            options={designationOptions}
            value={designation}
            onChange={setDesignation}
            placeholder="Select designation"
            disabled={!departmentId}
          />

          <SearchableSelect
            label="Change Type *"
            options={CHANGE_TYPE_OPTIONS}
            value={changeTypeToLabel(changeType)}
            onChange={(label) => setChangeType(labelToChangeType(label))}
            placeholder="Select change type"
          />

          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Effective Date *</Label>
            <DateInput
              value={effectiveDate}
              onChange={setEffectiveDate}
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
