import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { payrollApi } from '@/api/endpoints/payroll'
import { PayslipDocument } from '@/components/payroll/PayslipDocument'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { buildPayslipSlipFromEntry } from '@/lib/payslipSlip'
import type { Employee, PayrollEntry } from '@/types'

type PayslipViewDialogProps = {
  entry: PayrollEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
  employee?: Partial<
    Pick<
      Employee,
      | 'fullName'
      | 'employeeCode'
      | 'cnic'
      | 'currentDesignation'
      | 'dutyStartTime'
      | 'dutyEndTime'
      | 'dutyTotalHours'
      | 'currentBranch'
      | 'currentDepartment'
    >
  > | null
}

export function PayslipViewDialog({
  entry,
  open,
  onOpenChange,
  employee,
}: PayslipViewDialogProps) {
  const { data: fullEntry, isLoading } = useQuery({
    queryKey: ['payroll-entry-full', entry?.id],
    queryFn: () => payrollApi.getEntryFull(entry!.id),
    enabled: !!entry && open,
    retry: 1,
  })

  if (!entry) return null

  const data = fullEntry ?? entry
  const fromEntry = data.stipendRecord?.employee
  const slip =
    data.slip ??
    buildPayslipSlipFromEntry({
      ...data,
      stipendRecord: {
        ...data.stipendRecord,
        employee: {
          fullName: fromEntry?.fullName ?? employee?.fullName,
          employeeCode: fromEntry?.employeeCode ?? employee?.employeeCode,
          cnic: fromEntry?.cnic ?? employee?.cnic,
          currentDesignation:
            fromEntry?.currentDesignation ?? employee?.currentDesignation,
          dutyStartTime: employee?.dutyStartTime,
          dutyEndTime: employee?.dutyEndTime,
          dutyTotalHours:
            fromEntry?.dutyTotalHours ?? employee?.dutyTotalHours,
          currentBranch:
            fromEntry?.currentBranch ?? employee?.currentBranch ?? undefined,
          currentDepartment:
            fromEntry?.currentDepartment ??
            employee?.currentDepartment ??
            undefined,
        },
      },
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90dvh,90vh)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="no-print">
          <DialogTitle>Payslip</DialogTitle>
        </DialogHeader>

        <div className="no-print mb-4 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <PayslipDocument slip={slip} />
        )}
      </DialogContent>
    </Dialog>
  )
}
