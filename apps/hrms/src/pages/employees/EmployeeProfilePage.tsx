import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  Download,
  FileText,
  Loader2,
  Trash2,
} from 'lucide-react'
import { useParams } from 'react-router-dom'
import { attendanceApi } from '@/api/endpoints/attendance'
import { disciplinaryApi } from '@/api/endpoints/disciplinary'
import { employeesApi } from '@/api/endpoints/employees'
import { leaveApi } from '@/api/endpoints/leave'
import { lettersApi } from '@/api/endpoints/letters'
import { ChangeStatusDialog } from '@/components/employees/ChangeStatusDialog'
import { EmployeeAvatar } from '@/components/employees/EmployeeAvatar'
import { GenerateLetterDialog } from '@/components/employees/GenerateLetterDialog'
import { StatusBadge } from '@/components/employees/StatusBadge'
import { TransferDialog } from '@/components/employees/TransferDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import type {
  DocumentType,
  EmployeeDocument,
  EmploymentHistory,
  Letter,
  SalaryRecord,
} from '@/types'

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

export function EmployeeProfilePage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [uploadType, setUploadType] = useState<DocumentType>('CNIC')

  const [letterOpen, setLetterOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)

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

  const history = (employee.employmentHistory ?? []) as EmploymentHistory[]
  const salaries = (employee.salaryRecords ?? []) as SalaryRecord[]
  const documents = (employee.documents ?? []) as EmployeeDocument[]
  const overtimeHours = ((attendanceSummary?.overtimeMinutes ?? 0) / 60).toFixed(1)

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[35%_1fr]">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
          <EmployeeAvatar
            firstName={employee.firstName}
            lastName={employee.lastName}
            size="lg"
          />
          <div>
            <h1 className="text-xl font-bold">
              {employee.firstName} {employee.lastName}
            </h1>
            <Badge variant="outline" className="mt-2 font-mono">
              {employee.employeeCode}
            </Badge>
          </div>
          <p className="text-text-secondary">{employee.currentDesignation}</p>
          <p className="text-sm">
            <span className="font-medium">
              {employee.currentDepartment?.name ?? '—'}
            </span>
            {' · '}
            <span className="text-text-secondary">
              {employee.currentBranch?.name ?? '—'}
            </span>
          </p>
          <StatusBadge status={employee.status} />
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
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview" className="min-w-0">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
          <TabsTrigger value="letters">Letters</TabsTrigger>
          <TabsTrigger value="disciplinary">Disciplinary</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
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
                          {entry.branch?.name ?? '—'} ·{' '}
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
              <CardTitle className="text-lg">Salary History</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Basic Salary</TableHead>
                    <TableHead>Effective From</TableHead>
                    <TableHead>Effective To</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salaries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-text-secondary">
                        No salary records
                      </TableCell>
                    </TableRow>
                  ) : (
                    salaries.map((rec, i) => (
                      <TableRow key={rec.id}>
                        <TableCell>
                          PKR {Number(rec.basicSalary).toLocaleString()}
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
                              ? format(new Date(log.checkIn), 'HH:mm')
                              : '—'}
                          </TableCell>
                          <TableCell>
                            {log.checkOut
                              ? format(new Date(log.checkOut), 'HH:mm')
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
      </Tabs>

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
    </div>
  )
}
