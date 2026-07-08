import { Fragment, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Fingerprint,
  Loader2,
  Pencil,
  Plus,
  Printer,
  Trash2,
  X,
} from 'lucide-react'
import { useParams } from 'react-router-dom'
import { authApi } from '@/api/endpoints/auth'
import { attendanceApi } from '@/api/endpoints/attendance'
import { disciplinaryApi } from '@/api/endpoints/disciplinary'
import { employeesApi } from '@/api/endpoints/employees'
import { leaveApi } from '@/api/endpoints/leave'
import { lettersApi } from '@/api/endpoints/letters'
import { previousEmploymentApi } from '@/api/endpoints/previousEmployment'
import { qualificationsApi } from '@/api/endpoints/qualifications'
import { incentivesApi } from '@/api/endpoints/incentives'
import { EmployeePayrollTab } from '@/components/employees/EmployeePayrollTab'
import { AddIncentiveDialog } from '@/pages/incentives/AddIncentiveDialog'
import { ChangeStatusDialog } from '@/components/employees/ChangeStatusDialog'
import { EditEmployeeDialog } from '@/components/employees/EditEmployeeDialog'
import { EmployeeAvatar } from '@/components/employees/EmployeeAvatar'
import { GenerateLetterDialog } from '@/components/employees/GenerateLetterDialog'
import { StatusBadge } from '@/components/employees/StatusBadge'
import { TransferDialog } from '@/components/employees/TransferDialog'
import { UpdateBranchDutyDialog } from '@/components/employees/UpdateBranchDutyDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { formatDutyDisplay } from '@/lib/dutyTimes'
import { formatDateTimeTime } from '@/lib/timeFormat'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import { maritalStatusToLabel } from '@/lib/searchableSelectOptions'
import type {
  AcademicQualification,
  DocumentType,
  EmployeeDocument,
  EmploymentHistory,
  Incentive,
  Letter,
  PreviousEmployment,
  QualType,
  StipendRecord,
} from '@/types'

const HR_EMPLOYEE_EDIT_ROLES = [
  'SUPER_ADMIN',
  'HR_MANAGER',
  'HR_ADMIN_MANAGER',
  'ADMIN_OFFICER',
] as const

const API_BASE = import.meta.env.VITE_API_URL || 'http://187.127.115.103:3000'

function resolveFileUrl(path: string) {
  if (path.startsWith('http')) return path
  return `${API_BASE}${path}`
}

function letterReference(letter: Letter) {
  if (letter.fileUrl) {
    const name = letter.fileUrl.split('/').pop() ?? ''
    return name.replace(/\.pdf$/i, '').replace(/_/g, '/')
  }
  return letter.id.slice(0, 8).toUpperCase()
}

function leaveStatusBadge(status: string) {
  const styles: Record<string, string> = {
    APPROVED: 'bg-green-100 text-green-800',
    PENDING: 'bg-yellow-100 text-yellow-800',
    REJECTED: 'bg-red-100 text-red-800',
    CANCELLED: 'bg-gray-100 text-gray-700',
  }
  return (
    <Badge variant="outline" className={styles[status] ?? ''}>
      {status}
    </Badge>
  )
}

interface QualFormState {
  degree: string
  boardUniversity: string
  obtainedMarks: string
  divisionGrade: string
}

const emptyQualForm = (): QualFormState => ({
  degree: '',
  boardUniversity: '',
  obtainedMarks: '',
  divisionGrade: '',
})

function QualificationSection({
  employeeId,
  qualType,
  title,
  qualifications,
  isLoading,
}: {
  employeeId: string
  qualType: QualType
  title: string
  qualifications: AcademicQualification[]
  isLoading: boolean
}) {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<QualFormState>(emptyQualForm())
  const [adding, setAdding] = useState(false)
  const [newForm, setNewForm] = useState<QualFormState>(emptyQualForm())

  const filtered = qualifications.filter((q) => q.qualType === qualType)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['qualifications', employeeId] })

  const createMutation = useMutation({
    mutationFn: () =>
      qualificationsApi.create({
        employeeId,
        qualType,
        degree: newForm.degree,
        boardUniversity: newForm.boardUniversity,
        obtainedMarks: newForm.obtainedMarks || undefined,
        divisionGrade: newForm.divisionGrade || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Qualification added' })
      setAdding(false)
      setNewForm(emptyQualForm())
      invalidate()
    },
    onError: () => {
      toast({ title: 'Failed to add qualification', variant: 'destructive' })
    },
  })

  const updateMutation = useMutation({
    mutationFn: (qualId: string) =>
      qualificationsApi.update(qualId, {
        degree: editForm.degree,
        boardUniversity: editForm.boardUniversity,
        obtainedMarks: editForm.obtainedMarks || undefined,
        divisionGrade: editForm.divisionGrade || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Qualification updated' })
      setEditingId(null)
      invalidate()
    },
    onError: () => {
      toast({ title: 'Failed to update qualification', variant: 'destructive' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (qualId: string) => qualificationsApi.delete(qualId),
    onSuccess: () => {
      toast({ title: 'Qualification deleted' })
      invalidate()
    },
    onError: () => {
      toast({ title: 'Failed to delete qualification', variant: 'destructive' })
    },
  })

  const startEdit = (qual: AcademicQualification) => {
    setEditingId(qual.id)
    setEditForm({
      degree: qual.degree,
      boardUniversity: qual.boardUniversity,
      obtainedMarks: qual.obtainedMarks ?? '',
      divisionGrade: qual.divisionGrade ?? '',
    })
  }

  const renderFormRow = (
    form: QualFormState,
    setForm: (f: QualFormState) => void,
    onSave: () => void,
    onCancel: () => void,
    saving: boolean,
  ) => (
    <TableRow>
      <TableCell>
        <Input
          value={form.degree}
          onChange={(e) => setForm({ ...form, degree: e.target.value })}
          placeholder="Degree"
        />
      </TableCell>
      <TableCell>
        <Input
          value={form.boardUniversity}
          onChange={(e) =>
            setForm({ ...form, boardUniversity: e.target.value })
          }
          placeholder="Board / University"
        />
      </TableCell>
      <TableCell>
        <Input
          value={form.obtainedMarks}
          onChange={(e) =>
            setForm({ ...form, obtainedMarks: e.target.value })
          }
          placeholder="Marks"
        />
      </TableCell>
      <TableCell>
        <Input
          value={form.divisionGrade}
          onChange={(e) =>
            setForm({ ...form, divisionGrade: e.target.value })
          }
          placeholder="Division / Grade"
        />
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button
            size="sm"
            className="bg-primary hover:bg-primary-dark"
            disabled={
              saving || !form.degree.trim() || !form.boardUniversity.trim()
            }
            onClick={onSave}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">{title}</CardTitle>
        {!adding && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAdding(true)
              setNewForm(emptyQualForm())
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Degree</TableHead>
                <TableHead>Board / University</TableHead>
                <TableHead>Marks</TableHead>
                <TableHead>Division / Grade</TableHead>
                <TableHead className="w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && !adding && (
                <TableRow>
                  <TableCell colSpan={5} className="text-text-secondary">
                    No qualifications recorded
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((qual) =>
                editingId === qual.id
                  ? renderFormRow(
                      editForm,
                      setEditForm,
                      () => updateMutation.mutate(qual.id),
                      () => setEditingId(null),
                      updateMutation.isPending,
                    )
                  : (
                    <TableRow key={qual.id}>
                      <TableCell>{qual.degree}</TableCell>
                      <TableCell>{qual.boardUniversity}</TableCell>
                      <TableCell>{qual.obtainedMarks ?? '—'}</TableCell>
                      <TableCell>{qual.divisionGrade ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(qual)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={deleteMutation.isPending}
                            onClick={() => deleteMutation.mutate(qual.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ),
              )}
              {adding &&
                renderFormRow(
                  newForm,
                  setNewForm,
                  () => createMutation.mutate(),
                  () => setAdding(false),
                  createMutation.isPending,
                )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function AddPreviousEmploymentDialog({
  open,
  onOpenChange,
  employeeId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  employeeId: string
}) {
  const queryClient = useQueryClient()
  const [organizationName, setOrganizationName] = useState('')
  const [ownerAdminName, setOwnerAdminName] = useState('')
  const [contactNumber, setContactNumber] = useState('')
  const [postalAddress, setPostalAddress] = useState('')
  const [totalExperience, setTotalExperience] = useState('')
  const [relevantExperience, setRelevantExperience] = useState('')
  const [jobResponsibilities, setJobResponsibilities] = useState('')

  const reset = () => {
    setOrganizationName('')
    setOwnerAdminName('')
    setContactNumber('')
    setPostalAddress('')
    setTotalExperience('')
    setRelevantExperience('')
    setJobResponsibilities('')
  }

  const mutation = useMutation({
    mutationFn: () =>
      previousEmploymentApi.create({
        employeeId,
        organizationName,
        ownerAdminName: ownerAdminName || undefined,
        contactNumber: contactNumber || undefined,
        postalAddress: postalAddress || undefined,
        totalExperience: totalExperience || undefined,
        relevantExperience: relevantExperience || undefined,
        jobResponsibilities: jobResponsibilities || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Previous employment added' })
      queryClient.invalidateQueries({
        queryKey: ['previous-employment', employeeId],
      })
      reset()
      onOpenChange(false)
    },
    onError: () => {
      toast({
        title: 'Failed to add previous employment',
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Previous Employment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Organization Name *</Label>
            <Input
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Owner / Admin Name</Label>
              <Input
                value={ownerAdminName}
                onChange={(e) => setOwnerAdminName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Contact Number</Label>
              <Input
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Postal Address</Label>
            <Input
              value={postalAddress}
              onChange={(e) => setPostalAddress(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Total Experience</Label>
              <Input
                value={totalExperience}
                onChange={(e) => setTotalExperience(e.target.value)}
                placeholder="e.g. 3 years"
              />
            </div>
            <div className="space-y-2">
              <Label>Relevant Experience</Label>
              <Input
                value={relevantExperience}
                onChange={(e) => setRelevantExperience(e.target.value)}
                placeholder="e.g. 2 years"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Job Responsibilities</Label>
            <Textarea
              value={jobResponsibilities}
              onChange={(e) => setJobResponsibilities(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={!organizationName.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Adding...' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordDialog({
  open,
  onOpenChange,
  employeeName,
  userId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  employeeName: string
  userId: string
}) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const resetMutation = useMutation({
    mutationFn: () => authApi.resetPassword({ userId, newPassword }),
    onSuccess: () => {
      toast({ title: 'Password reset successfully' })
      setNewPassword('')
      setConfirmPassword('')
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to reset password',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const handleSubmit = () => {
    if (newPassword.length < 6) {
      toast({
        title: 'Password too short',
        description: 'Password must be at least 6 characters',
        variant: 'destructive',
      })
      return
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: 'Passwords do not match',
        variant: 'destructive',
      })
      return
    }
    resetMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset Password for {employeeName}</DialogTitle>
        </DialogHeader>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          This will immediately change the employee&apos;s portal login password.
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>New Password</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimum 6 characters"
            />
          </div>
          <div className="space-y-2">
            <Label>Confirm Password</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={resetMutation.isPending}
            onClick={handleSubmit}
          >
            {resetMutation.isPending ? 'Resetting...' : 'Reset Password'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function EmployeeProfilePage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [uploadType, setUploadType] = useState<DocumentType>('CNIC')

  const [letterOpen, setLetterOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [branchDutyOpen, setBranchDutyOpen] = useState(false)
  const [editDetailsOpen, setEditDetailsOpen] = useState(false)
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false)
  const [prevEmpOpen, setPrevEmpOpen] = useState(false)
  const [incentiveOpen, setIncentiveOpen] = useState(false)
  const [expandedPrevEmpId, setExpandedPrevEmpId] = useState<string | null>(
    null,
  )

  const { data: employee, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => employeesApi.getOne(id),
    enabled: !!id,
  })

  const { data: attendanceSummary, isLoading: loadingSummary } = useQuery({
    queryKey: ['attendance-summary', id, month, year],
    queryFn: () => attendanceApi.getSummary(id, month, year),
    enabled: !!id,
  })

  const { data: workingHours, isLoading: loadingWorkingHours } = useQuery({
    queryKey: ['working-hours', id],
    queryFn: () => employeesApi.getWorkingHours(id),
    enabled: !!id,
  })

  const { data: attendanceLogs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ['attendance-logs', id, month, year],
    queryFn: () => attendanceApi.getAll({ employeeId: id, month, year }),
    enabled: !!id,
  })

  const { data: leaves = [], isLoading: loadingLeaves } = useQuery({
    queryKey: ['leave', id],
    queryFn: () => leaveApi.getAll({ employeeId: id }),
    enabled: !!id,
  })

  const { data: leaveBalance } = useQuery({
    queryKey: ['leave-balance', id, year],
    queryFn: () => leaveApi.getBalance(id, year),
    enabled: !!id,
  })

  const { data: letters = [], isLoading: loadingLetters } = useQuery({
    queryKey: ['letters', id],
    queryFn: () => lettersApi.getAll({ employeeId: id }),
    enabled: !!id,
  })

  const { data: disciplinary = [], isLoading: loadingDisciplinary } = useQuery({
    queryKey: ['disciplinary', id],
    queryFn: () => disciplinaryApi.getAll({ employeeId: id }),
    enabled: !!id,
  })

  const { data: qualifications = [], isLoading: loadingQualifications } =
    useQuery({
      queryKey: ['qualifications', id],
      queryFn: () => qualificationsApi.getByEmployee(id),
      enabled: !!id,
    })

  const {
    data: previousEmployments = [],
    isLoading: loadingPreviousEmployment,
  } = useQuery({
    queryKey: ['previous-employment', id],
    queryFn: () => previousEmploymentApi.getByEmployee(id),
    enabled: !!id,
  })

  const { data: incentives = [], isLoading: loadingIncentives } = useQuery({
    queryKey: ['incentives', id],
    queryFn: () => incentivesApi.getByEmployee(id),
    enabled: !!id,
  })

  const canAddIncentive =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'HR_MANAGER' ||
    user?.role === 'HR_ADMIN_MANAGER' ||
    user?.role === 'ADMIN_OFFICER'

  const incentiveTotal = (incentives as Incentive[]).reduce(
    (sum, i) => sum + Number(i.amount),
    0,
  )

  const deletePrevEmpMutation = useMutation({
    mutationFn: (recordId: string) => previousEmploymentApi.delete(recordId),
    onSuccess: () => {
      toast({ title: 'Previous employment deleted' })
      queryClient.invalidateQueries({ queryKey: ['previous-employment', id] })
    },
    onError: () => {
      toast({
        title: 'Failed to delete previous employment',
        variant: 'destructive',
      })
    },
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData()
      formData.append('documentType', uploadType)
      formData.append('file', file)
      return employeesApi.uploadDocument(id, formData)
    },
    onSuccess: () => {
      toast({ title: 'Document uploaded' })
      queryClient.invalidateQueries({ queryKey: ['employee', id] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Upload failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const photoUploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData()
      formData.append('photo', file)
      return employeesApi.uploadPhoto(id, formData)
    },
    onSuccess: () => {
      toast({ title: 'Photo updated' })
      queryClient.invalidateQueries({ queryKey: ['employee', id] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Photo upload failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const deleteDocMutation = useMutation({
    mutationFn: (documentId: string) =>
      employeesApi.deleteDocument(id, documentId),
    onSuccess: () => {
      toast({ title: 'Document deleted' })
      queryClient.invalidateQueries({ queryKey: ['employee', id] })
    },
    onError: () => {
      toast({ title: 'Failed to delete document', variant: 'destructive' })
    },
  })

  const markPrintedMutation = useMutation({
    mutationFn: (letterId: string) => lettersApi.markPrinted(letterId),
    onSuccess: () => {
      toast({ title: 'Letter marked as printed' })
      queryClient.invalidateQueries({ queryKey: ['letters', id] })
    },
  })

  const downloadPdf = async (letterId: string) => {
    try {
      const blob = await lettersApi.getPdf(letterId)
      window.open(URL.createObjectURL(blob), '_blank')
    } catch {
      toast({ title: 'Failed to download PDF', variant: 'destructive' })
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (!employee) {
    return (
      <p className="text-text-secondary">Employee not found.</p>
    )
  }

  const needsJobAssignment =
    employee.currentDepartmentId == null || employee.currentDesignation == null

  const history = (employee.employmentHistory ?? []) as EmploymentHistory[]
  const stipends = (employee.stipendRecords ?? []) as StipendRecord[]
  const latestStipend = stipends[0]
  const basicStipendAmount = latestStipend
    ? Number(latestStipend.basicStipend)
    : 0
  const payrollTotal = basicStipendAmount + incentiveTotal
  const photoSrc = employee.photoUrl
    ? resolveFileUrl(employee.photoUrl)
    : undefined
  const documents = (employee.documents ?? []) as EmployeeDocument[]
  const overtimeHours = ((attendanceSummary?.overtimeMinutes ?? 0) / 60).toFixed(1)

  const canEditEmployee =
    !!user?.role &&
    HR_EMPLOYEE_EDIT_ROLES.includes(
      user.role as (typeof HR_EMPLOYEE_EDIT_ROLES)[number],
    )

  const canEditBranchDuty =
    canEditEmployee && user?.employeeId !== employee.id

  const hasPersonalInfo =
    employee.bloodGroup ||
    employee.caste ||
    employee.domicile ||
    employee.province ||
    employee.city ||
    employee.district ||
    employee.tehsil ||
    employee.policeStation ||
    employee.fatherContactNumber ||
    employee.emergencyContactName ||
    employee.emergencyContactNumber ||
    employee.spouseName ||
    employee.spouseContactNumber ||
    employee.currentAddress ||
    employee.permanentAddress

  return (
    <>
      <input
        ref={photoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/jpg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) photoUploadMutation.mutate(file)
          e.target.value = ''
        }}
      />

      {needsJobAssignment && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          ⚠️ This employee needs department/designation assignment. Please
          update their job information.
        </div>
      )}

      <div className="print-only hidden">
        <div className="print-header">
          <h1 className="text-2xl font-bold">YCDO</h1>
          <p className="text-sm">Youth Community Development Organization</p>
        </div>
        <h2 className="mb-2 text-center text-lg font-semibold">
          Employee Profile
        </h2>
        <p className="mb-6 text-center text-sm">
          {employee.employeeCode} · Printed{' '}
          {format(new Date(), 'dd/MM/yyyy')}
        </p>

        <h3 className="mb-2 font-semibold">Personal Information</h3>
        <div className="print-grid mb-6">
          <div className="print-field">
            <div className="print-label">Full Name</div>
            {employee.fullName}
          </div>
          <div className="print-field">
            <div className="print-label">CNIC</div>
            {employee.cnic ?? '—'}
          </div>
          <div className="print-field">
            <div className="print-label">Date of Birth</div>
            {employee.dateOfBirth
              ? format(new Date(employee.dateOfBirth), 'dd/MM/yyyy')
              : '—'}
          </div>
          <div className="print-field">
            <div className="print-label">Gender</div>
            {employee.gender}
          </div>
          <div className="print-field">
            <div className="print-label">Blood Group</div>
            {employee.bloodGroup ?? '—'}
          </div>
          <div className="print-field">
            <div className="print-label">Marital Status</div>
            {employee.maritalStatus
              ? maritalStatusToLabel(employee.maritalStatus)
              : '—'}
          </div>
          <div className="print-field">
            <div className="print-label">Father Name</div>
            {employee.fatherName ?? '—'}
          </div>
          <div className="print-field">
            <div className="print-label">Caste</div>
            {employee.caste ?? '—'}
          </div>
        </div>

        <h3 className="mb-2 font-semibold">Contact Information</h3>
        <div className="print-grid mb-6">
          <div className="print-field">
            <div className="print-label">Phone</div>
            {employee.phone ?? '—'}
          </div>
          <div className="print-field">
            <div className="print-label">Email</div>
            {employee.email ?? '—'}
          </div>
          <div className="print-field">
            <div className="print-label">Emergency Contact</div>
            {employee.emergencyContactName ?? '—'}
            {employee.emergencyRelation
              ? ` (${employee.emergencyRelation})`
              : ''}
          </div>
          <div className="print-field">
            <div className="print-label">Emergency Number</div>
            {employee.emergencyContactNumber ?? '—'}
          </div>
          <div className="print-field sm:col-span-2">
            <div className="print-label">Current Address</div>
            {employee.currentAddress ?? '—'}
          </div>
        </div>

        <h3 className="mb-2 font-semibold">Employment Details</h3>
        <div className="print-grid mb-6">
          <div className="print-field">
            <div className="print-label">Designation</div>
            {employee.currentDesignation ?? '—'}
          </div>
          <div className="print-field">
            <div className="print-label">Department</div>
            {employee.currentDepartment?.name ?? '—'}
          </div>
          <div className="print-field">
            <div className="print-label">Branch</div>
            {formatBranchLabel(employee.currentBranch)}
          </div>
          <div className="print-field">
            <div className="print-label">Joining Date</div>
            {format(new Date(employee.joiningDate), 'dd/MM/yyyy')}
          </div>
          <div className="print-field">
            <div className="print-label">Shift</div>
            {employee.shift?.name ?? '—'}
          </div>
          <div className="print-field">
            <div className="print-label">Duty Hours</div>
            {employee.dutyStartTime && employee.dutyEndTime
              ? formatDutyDisplay(employee.dutyStartTime, employee.dutyEndTime)
              : '—'}
          </div>
        </div>

        <h3 className="mb-2 font-semibold">Payroll Summary</h3>
        <div className="print-grid mb-10">
          <div className="print-field">
            <div className="print-label">Basic Stipend</div>
            PKR {basicStipendAmount.toLocaleString()}
          </div>
          <div className="print-field">
            <div className="print-label">Total (incl. incentives)</div>
            PKR {payrollTotal.toLocaleString()}
          </div>
        </div>

        <p className="mt-8 text-sm">
          HR Manager _________________________ Date _______________
        </p>
      </div>

    <div className="no-print grid grid-cols-1 gap-6 lg:grid-cols-[35%_1fr]">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
          <EmployeeAvatar
            fullName={employee.fullName}
            photoUrl={photoSrc}
            size="lg"
            onPhotoClick={
              canEditEmployee
                ? () => photoInputRef.current?.click()
                : undefined
            }
          />
          <div>
            <h1 className="text-xl font-bold">
              {employee.fullName}
            </h1>
            <Badge variant="outline" className="mt-2 font-mono">
              {employee.employeeCode}
            </Badge>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-text-secondary">
              <Fingerprint className="h-3.5 w-3.5" />
              <span>Biometric ID: {employee.biometricId ?? 'Not assigned'}</span>
            </p>
          </div>
          <p className="text-text-secondary">{employee.currentDesignation ?? '—'}</p>
          <p className="text-sm">
            <span className="font-medium">
              {employee.currentDepartment?.name ?? '—'}
            </span>
            {' · '}
            <span className="text-text-secondary">
              {formatBranchLabel(employee.currentBranch)}
            </span>
          </p>
          <StatusBadge status={employee.status} />
          <p
            className={`flex w-full items-center justify-center gap-1.5 text-sm ${
              employee.dutyStartTime && employee.dutyEndTime
                ? 'text-text-primary'
                : 'text-text-secondary'
            }`}
          >
            <Clock className="h-4 w-4 shrink-0" />
            <span>
              Duty:{' '}
              {employee.dutyStartTime && employee.dutyEndTime
                ? formatDutyDisplay(employee.dutyStartTime, employee.dutyEndTime)
                : 'Not assigned'}
            </span>
          </p>
          <div className="w-full space-y-2 text-left text-sm">
            <p>
              <span className="text-text-secondary">Joined: </span>
              {format(new Date(employee.joiningDate), 'dd/MM/yyyy')}
            </p>
            <p>
              <span className="text-text-secondary">CNIC: </span>
              {employee.cnic}
            </p>
            <p>
              <span className="text-text-secondary">Phone: </span>
              {employee.phone ?? '—'}
              {' · '}
              <span className="text-text-secondary">Email: </span>
              {employee.email ?? '—'}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2">
            {canEditEmployee && (
              <Button
                variant="outline"
                className="w-full no-print"
                onClick={() => window.print()}
              >
                <Printer className="mr-2 h-4 w-4" />
                Print Profile
              </Button>
            )}
            {canEditEmployee && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setEditDetailsOpen(true)}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit Details
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setLetterOpen(true)}
            >
              Generate Letter
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setStatusOpen(true)}
            >
              Change Status
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setTransferOpen(true)}
            >
              Transfer
            </Button>
            {canEditBranchDuty && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setBranchDutyOpen(true)}
              >
                Edit Branch & Duty
              </Button>
            )}
            {user?.role === 'SUPER_ADMIN' && employee.user?.id && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setResetPasswordOpen(true)}
              >
                Reset Password
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview" className="min-w-0">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="payroll">Payroll</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
          <TabsTrigger value="letters">Letters</TabsTrigger>
          <TabsTrigger value="disciplinary">Disciplinary</TabsTrigger>
          <TabsTrigger value="qualifications">Qualifications</TabsTrigger>
          <TabsTrigger value="previous-employment">Previous Employment</TabsTrigger>
          <TabsTrigger value="incentives">Incentives</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {employee.user?.role === 'ADMIN_MANAGER' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Login Credentials</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  <span className="text-text-secondary">Email: </span>
                  {employee.user.email}
                </p>
                <p>
                  <span className="text-text-secondary">Password: </span>
                  <span className="font-mono">
                    {employee.user.passwordRecord?.plainText ?? '—'}
                  </span>
                </p>
                <p>
                  <span className="text-text-secondary">Branch: </span>
                  {employee.user.branch?.name ??
                    formatBranchLabel(employee.currentBranch)}
                </p>
                <p>
                  <span className="text-text-secondary">Role: </span>
                  Admin Manager
                </p>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg">Personal Info</CardTitle>
              {canEditEmployee && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditDetailsOpen(true)}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {hasPersonalInfo ? (
                <>
                <div className="flex flex-wrap items-center gap-2">
                  {employee.bloodGroup && (
                    <Badge variant="outline" className="bg-red-50 text-red-700">
                      Blood Group: {employee.bloodGroup}
                    </Badge>
                  )}
                  {employee.caste && (
                    <span>
                      <span className="text-text-secondary">Caste: </span>
                      {employee.caste}
                    </span>
                  )}
                </div>
                {(employee.province || employee.city) && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {employee.province && (
                      <p>
                        <span className="text-text-secondary">Province: </span>
                        {employee.province}
                      </p>
                    )}
                    {employee.city && (
                      <p>
                        <span className="text-text-secondary">City: </span>
                        {employee.city}
                      </p>
                    )}
                  </div>
                )}
                {(employee.domicile ||
                  employee.district ||
                  employee.tehsil ||
                  employee.policeStation) && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {employee.domicile && (
                      <p>
                        <span className="text-text-secondary">Domicile: </span>
                        {employee.domicile}
                      </p>
                    )}
                    {employee.district && (
                      <p>
                        <span className="text-text-secondary">District: </span>
                        {employee.district}
                      </p>
                    )}
                    {employee.tehsil && (
                      <p>
                        <span className="text-text-secondary">Tehsil: </span>
                        {employee.tehsil}
                      </p>
                    )}
                    {employee.policeStation && (
                      <p>
                        <span className="text-text-secondary">
                          Police Station:{' '}
                        </span>
                        {employee.policeStation}
                      </p>
                    )}
                  </div>
                )}
                {employee.fatherContactNumber && (
                  <p>
                    <span className="text-text-secondary">
                      Father Contact:{' '}
                    </span>
                    {employee.fatherContactNumber}
                  </p>
                )}
                {(employee.emergencyContactName ||
                  employee.emergencyContactNumber) && (
                  <p>
                    <span className="text-text-secondary">
                      Emergency Contact:{' '}
                    </span>
                    {employee.emergencyContactName ?? '—'}
                    {employee.emergencyContactNumber &&
                      ` (${employee.emergencyContactNumber})`}
                  </p>
                )}
                {(employee.spouseName || employee.spouseContactNumber) && (
                  <p>
                    <span className="text-text-secondary">Spouse: </span>
                    {employee.spouseName ?? '—'}
                    {employee.spouseContactNumber &&
                      ` (${employee.spouseContactNumber})`}
                  </p>
                )}
                {employee.currentAddress && (
                  <div>
                    <p className="text-text-secondary">Current Address</p>
                    <p className="whitespace-pre-wrap">
                      {employee.currentAddress}
                    </p>
                  </div>
                )}
                {employee.permanentAddress && (
                  <div>
                    <p className="text-text-secondary">Permanent Address</p>
                    <p className="whitespace-pre-wrap">
                      {employee.permanentAddress}
                    </p>
                  </div>
                )}
                </>
              ) : (
                <p className="text-text-secondary">
                  No personal details recorded yet.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Working Hours Summary</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingWorkingHours ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-20" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {[
                    {
                      label: 'Total Hours',
                      value: workingHours?.totalHours ?? 0,
                    },
                    {
                      label: 'This Month',
                      value: workingHours?.thisMonthHours ?? 0,
                    },
                    {
                      label: 'Days Worked',
                      value: workingHours?.totalDays ?? 0,
                    },
                    {
                      label: 'Avg Daily Hours',
                      value: workingHours?.averageDailyHours ?? 0,
                    },
                    {
                      label: 'Total Minutes',
                      value: workingHours?.totalMinutes ?? 0,
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-lg border border-border p-4 text-center"
                    >
                      <p className="text-2xl font-bold">{item.value}</p>
                      <p className="text-xs text-text-secondary">{item.label}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Employment History</CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-text-secondary">No history records</p>
              ) : (
                <div className="relative space-y-0 pl-6">
                  {history.map((entry, i) => (
                    <div key={entry.id} className="relative pb-8 last:pb-0">
                      {i < history.length - 1 && (
                        <div className="absolute left-[-18px] top-2 h-full w-0.5 bg-border" />
                      )}
                      <div className="absolute left-[-22px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                      <div className="rounded-lg border border-border p-4">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{entry.changeType}</Badge>
                          <span className="text-sm font-medium">
                            {entry.designation}
                          </span>
                        </div>
                        <p className="text-sm text-text-secondary">
                          {formatBranchLabel(entry.branch)} ·{' '}
                          {entry.department?.name ?? '—'}
                        </p>
                        <p className="mt-1 text-xs text-text-secondary">
                          {format(new Date(entry.effectiveDate), 'dd/MM/yyyy')} →{' '}
                          {entry.endDate
                            ? format(new Date(entry.endDate), 'dd/MM/yyyy')
                            : 'Present'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Stipend History</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Basic Stipend</TableHead>
                    <TableHead>Effective From</TableHead>
                    <TableHead>Effective To</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stipends.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-text-secondary">
                        No stipend records
                      </TableCell>
                    </TableRow>
                  ) : (
                    stipends.map((rec, i) => (
                      <TableRow key={rec.id}>
                        <TableCell>
                          PKR {Number(rec.basicStipend).toLocaleString()}
                          {i === 0 && !rec.effectiveTo && (
                            <Badge className="ml-2 bg-accent/20 text-accent-dark">
                              Current
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {format(new Date(rec.effectiveFrom), 'dd/MM/yyyy')}
                        </TableCell>
                        <TableCell>
                          {rec.effectiveTo
                            ? format(new Date(rec.effectiveTo), 'dd/MM/yyyy')
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Month</Label>
              <Select
                value={String(month)}
                onValueChange={(v) => setMonth(Number(v))}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {format(new Date(2000, m - 1, 1), 'MMMM')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Year</Label>
              <Input
                type="number"
                className="w-[100px]"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              />
            </div>
          </div>

          {loadingSummary ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {[
                { label: 'Present', value: attendanceSummary?.present ?? 0 },
                { label: 'Absent', value: attendanceSummary?.absent ?? 0 },
                { label: 'Late', value: attendanceSummary?.late ?? 0 },
                { label: 'Half Day', value: attendanceSummary?.halfDay ?? 0 },
                { label: 'On Leave', value: attendanceSummary?.onLeave ?? 0 },
                { label: 'Overtime Hrs', value: overtimeHours },
              ].map((item) => (
                <Card key={item.label}>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold">{item.value}</p>
                    <p className="text-xs text-text-secondary">{item.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Attendance Log</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingLogs ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Check In</TableHead>
                      <TableHead>Check Out</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Late Min</TableHead>
                      <TableHead>Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendanceLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-text-secondary">
                          No attendance records
                        </TableCell>
                      </TableRow>
                    ) : (
                      attendanceLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell>
                            {format(new Date(log.date), 'dd/MM/yyyy')}
                          </TableCell>
                          <TableCell>
                            {log.checkIn
                              ? formatDateTimeTime(log.checkIn)
                              : '—'}
                          </TableCell>
                          <TableCell>
                            {log.checkOut
                              ? formatDateTimeTime(log.checkOut)
                              : '—'}
                          </TableCell>
                          <TableCell>{log.status}</TableCell>
                          <TableCell>{log.lateMinutes ?? 0}</TableCell>
                          <TableCell>{log.source ?? '—'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payroll" className="space-y-4">
          <EmployeePayrollTab
            employeeId={id}
            stipendRecords={(employee.stipendRecords ?? []) as StipendRecord[]}
          />
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Document Type</Label>
              <Select
                value={uploadType}
                onValueChange={(v) => setUploadType(v as DocumentType)}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    [
                      'CNIC',
                      'EDUCATIONAL_CERTIFICATE',
                      'MEDICAL_CERTIFICATE',
                      'EXPERIENCE_LETTER',
                      'OTHER',
                    ] as DocumentType[]
                  ).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".jpg,.jpeg,.png,.pdf"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) uploadMutation.mutate(file)
                e.target.value = ''
              }}
            />
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={uploadMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Upload Document
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {documents.length === 0 ? (
              <p className="text-sm text-text-secondary">No documents uploaded</p>
            ) : (
              documents.map((doc) => (
                <Card key={doc.id}>
                  <CardContent className="space-y-3 p-4">
                    <Badge variant="outline">
                      {doc.documentType.replace(/_/g, ' ')}
                    </Badge>
                    <div className="flex items-start gap-2">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" />
                      <p className="break-all text-sm font-medium">{doc.fileName}</p>
                    </div>
                    <p className="text-xs text-text-secondary">
                      {format(new Date(doc.uploadedAt), 'dd/MM/yyyy')}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href={resolveFileUrl(doc.fileUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Download className="mr-1 h-3 w-3" />
                          Download
                        </a>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={deleteDocMutation.isPending}
                        onClick={() => deleteDocMutation.mutate(doc.id)}
                      >
                        <Trash2 className="h-3 w-3 text-red-600" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="leave" className="space-y-4">
          <Card>
            <CardContent className="p-6">
              {leaveBalance ? (
                <p className="text-lg">
                  Taken{' '}
                  <span className="font-bold">{leaveBalance.taken}</span> /{' '}
                  {leaveBalance.totalAllowed} days · Remaining{' '}
                  <span className="font-bold text-accent-dark">
                    {leaveBalance.remaining}
                  </span>{' '}
                  days
                </p>
              ) : (
                <Skeleton className="h-8 w-64" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Leave History</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingLeaves ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Days</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Approved By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaves.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-text-secondary">
                          No leave records
                        </TableCell>
                      </TableRow>
                    ) : (
                      leaves.map((leave) => (
                        <TableRow key={leave.id}>
                          <TableCell>
                            {format(new Date(leave.startDate), 'dd/MM/yyyy')}
                          </TableCell>
                          <TableCell>
                            {format(new Date(leave.endDate), 'dd/MM/yyyy')}
                          </TableCell>
                          <TableCell>{leave.totalDays}</TableCell>
                          <TableCell>{leave.reason ?? '—'}</TableCell>
                          <TableCell>{leaveStatusBadge(leave.status)}</TableCell>
                          <TableCell>{leave.approvedBy ?? '—'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="letters" className="space-y-4">
          <Button
            className="bg-primary hover:bg-primary-dark"
            onClick={() => setLetterOpen(true)}
          >
            Generate New Letter
          </Button>

          <Card>
            <CardContent className="p-0">
              {loadingLetters ? (
                <div className="space-y-2 p-4">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {letters.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-text-secondary">
                          No letters generated
                        </TableCell>
                      </TableRow>
                    ) : (
                      letters.map((letter) => (
                        <TableRow key={letter.id}>
                          <TableCell>
                            {letter.letterType.replace(/_/g, ' ')}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {letterReference(letter)}
                          </TableCell>
                          <TableCell>
                            {format(new Date(letter.generatedAt), 'dd/MM/yyyy')}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => downloadPdf(letter.id)}
                              >
                                Download PDF
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={
                                  !!letter.printedAt ||
                                  markPrintedMutation.isPending
                                }
                                onClick={() =>
                                  markPrintedMutation.mutate(letter.id)
                                }
                              >
                                {letter.printedAt ? 'Printed' : 'Mark Printed'}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="disciplinary" className="space-y-4">
          {loadingDisciplinary ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : disciplinary.length === 0 ? (
            <p className="text-sm text-text-secondary">
              No disciplinary actions on record
            </p>
          ) : (
            <div className="space-y-3">
              {disciplinary.map((action) => (
                <Card key={action.id}>
                  <CardContent className="flex flex-wrap items-center gap-3 p-4">
                    <Badge variant="outline">{action.type}</Badge>
                    <span className="flex-1 text-sm">{action.reason}</span>
                    <StatusBadge status={action.status} />
                    <span className="text-xs text-text-secondary">
                      {format(new Date(action.issuedAt), 'dd/MM/yyyy')}
                    </span>
                    {action.inquiry && (
                      <Badge variant="outline" className="text-xs">
                        Inquiry: {action.inquiry.outcome ?? 'Pending'}
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="qualifications" className="space-y-4">
          <QualificationSection
            employeeId={id}
            qualType="ACADEMIC"
            title="Academic Qualifications"
            qualifications={qualifications as AcademicQualification[]}
            isLoading={loadingQualifications}
          />
          <QualificationSection
            employeeId={id}
            qualType="JOB_RELEVANT"
            title="Job-Relevant Qualifications"
            qualifications={qualifications as AcademicQualification[]}
            isLoading={loadingQualifications}
          />
        </TabsContent>

        <TabsContent value="previous-employment" className="space-y-4">
          <Button
            className="bg-primary hover:bg-primary-dark"
            onClick={() => setPrevEmpOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Previous Employment
          </Button>

          <Card>
            <CardContent className="p-0">
              {loadingPreviousEmployment ? (
                <div className="space-y-2 p-4">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Organization</TableHead>
                      <TableHead>Owner / Admin</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Experience</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(previousEmployments as PreviousEmployment[]).length ===
                    0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-text-secondary">
                          No previous employment records
                        </TableCell>
                      </TableRow>
                    ) : (
                      (previousEmployments as PreviousEmployment[]).map(
                        (emp) => (
                          <Fragment key={emp.id}>
                            <TableRow key={emp.id}>
                              <TableCell>
                                {emp.jobResponsibilities && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0"
                                    onClick={() =>
                                      setExpandedPrevEmpId(
                                        expandedPrevEmpId === emp.id
                                          ? null
                                          : emp.id,
                                      )
                                    }
                                  >
                                    {expandedPrevEmpId === emp.id ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                  </Button>
                                )}
                              </TableCell>
                              <TableCell className="font-medium">
                                {emp.organizationName}
                              </TableCell>
                              <TableCell>
                                {emp.ownerAdminName ?? '—'}
                              </TableCell>
                              <TableCell>
                                {emp.contactNumber ?? '—'}
                              </TableCell>
                              <TableCell>
                                {emp.totalExperience ?? '—'}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={deletePrevEmpMutation.isPending}
                                  onClick={() =>
                                    deletePrevEmpMutation.mutate(emp.id)
                                  }
                                >
                                  <Trash2 className="h-4 w-4 text-red-600" />
                                </Button>
                              </TableCell>
                            </TableRow>
                            {expandedPrevEmpId === emp.id && (
                              <TableRow key={`${emp.id}-details`}>
                                <TableCell colSpan={6} className="bg-muted/30">
                                  <div className="space-y-2 p-2 text-sm">
                                    {emp.postalAddress && (
                                      <p>
                                        <span className="text-text-secondary">
                                          Address:{' '}
                                        </span>
                                        {emp.postalAddress}
                                      </p>
                                    )}
                                    {emp.relevantExperience && (
                                      <p>
                                        <span className="text-text-secondary">
                                          Relevant Experience:{' '}
                                        </span>
                                        {emp.relevantExperience}
                                      </p>
                                    )}
                                    {emp.jobResponsibilities && (
                                      <div>
                                        <p className="text-text-secondary">
                                          Job Responsibilities
                                        </p>
                                        <p className="whitespace-pre-wrap">
                                          {emp.jobResponsibilities}
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        ),
                      )
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="incentives" className="space-y-4">
          {canAddIncentive && (
            <Button
              className="bg-primary hover:bg-primary-dark"
              onClick={() => setIncentiveOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Incentive
            </Button>
          )}
          <Card>
            <CardContent className="p-0">
              {loadingIncentives ? (
                <div className="space-y-2 p-4">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month/Year</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Added By</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(incentives as Incentive[]).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-text-secondary">
                          No incentives recorded
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {(incentives as Incentive[]).map((item) => (
                          <TableRow key={item.id}>
                            <TableCell>
                              {item.month}/{item.year}
                            </TableCell>
                            <TableCell className="font-medium text-green-600">
                              PKR {Number(item.amount).toLocaleString('en-PK')}
                            </TableCell>
                            <TableCell className="max-w-[240px] truncate" title={item.reason}>
                              {item.reason}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {item.addedBy.slice(0, 8)}…
                            </TableCell>
                            <TableCell>
                              {format(new Date(item.createdAt), 'dd/MM/yyyy')}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-surface font-semibold">
                          <TableCell>Total</TableCell>
                          <TableCell className="text-green-600">
                            PKR {incentiveTotal.toLocaleString('en-PK')}
                          </TableCell>
                          <TableCell colSpan={3} />
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AddIncentiveDialog
        open={incentiveOpen}
        onOpenChange={setIncentiveOpen}
        defaultEmployeeId={id}
        onSuccess={() =>
          queryClient.invalidateQueries({ queryKey: ['incentives', id] })
        }
      />

      <AddPreviousEmploymentDialog
        open={prevEmpOpen}
        onOpenChange={setPrevEmpOpen}
        employeeId={id}
      />

      <GenerateLetterDialog
        open={letterOpen}
        onOpenChange={setLetterOpen}
        employeeId={id}
      />
      <ChangeStatusDialog
        open={statusOpen}
        onOpenChange={setStatusOpen}
        employeeId={id}
        currentStatus={employee.status}
      />
      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        employeeId={id}
        currentDesignation={employee.currentDesignation}
      />
      <UpdateBranchDutyDialog
        employee={employee}
        open={branchDutyOpen}
        onOpenChange={setBranchDutyOpen}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['employee', id] })
        }}
      />
      {editDetailsOpen && (
        <EditEmployeeDialog
          employee={employee}
          open={editDetailsOpen}
          onOpenChange={setEditDetailsOpen}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['employee', id] })
            queryClient.invalidateQueries({ queryKey: ['employees'] })
          }}
        />
      )}
      {employee.user?.id && (
        <ResetPasswordDialog
          open={resetPasswordOpen}
          onOpenChange={setResetPasswordOpen}
          employeeName={employee.fullName}
          userId={employee.user.id}
        />
      )}
    </div>
    </>
  )
}
