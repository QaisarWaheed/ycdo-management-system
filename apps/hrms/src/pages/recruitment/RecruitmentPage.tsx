import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { recruitmentApi } from '@/api/endpoints/recruitment'
import { shiftsApi } from '@/api/endpoints/shifts'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { PKRInput } from '@/components/common/PKRInput'
import { StatusBadge } from '@/components/employees/StatusBadge'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import type { Employee, JobApplication } from '@/types'

function statusBadgeClass(status: string) {
  const map: Record<string, string> = {
    APPLIED: 'bg-blue-100 text-blue-800 border-blue-200',
    SHORTLISTED: 'bg-amber-100 text-amber-800 border-amber-200',
    INTERVIEW_SCHEDULED: 'bg-purple-100 text-purple-800 border-purple-200',
    SELECTED: 'bg-green-100 text-green-800 border-green-200',
    REJECTED: 'bg-red-100 text-red-800 border-red-200',
  }
  return map[status] ?? ''
}

function ScheduleInterviewDialog({
  application,
  open,
  onOpenChange,
}: {
  application: JobApplication | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [notes, setNotes] = useState('')

  const mutation = useMutation({
    mutationFn: () => {
      const interviewDate = date && time ? `${date}T${time}:00` : date
      return recruitmentApi.updateStatus(application!.id, {
        status: 'INTERVIEW_SCHEDULED',
        interviewDate,
        notes: notes || undefined,
      })
    },
    onSuccess: () => {
      toast({ title: 'Interview scheduled' })
      queryClient.invalidateQueries({ queryKey: ['recruitment'] })
      setDate('')
      setTime('')
      setNotes('')
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to schedule interview',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule Interview</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Interview Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Interview Time</Label>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={!date || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving...' : 'Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AcceptCandidateDialog({
  application,
  open,
  onOpenChange,
  onAccepted,
}: {
  application: JobApplication | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onAccepted: (result: {
    employee: { id: string; employeeCode: string }
    temporaryPassword: string
  }) => void
}) {
  const queryClient = useQueryClient()
  const [branchId, setBranchId] = useState('')
  const [deptId, setDeptId] = useState('')
  const [designation, setDesignation] = useState('')
  const [shiftId, setShiftId] = useState('')
  const [salary, setSalary] = useState(0)
  const [interviewNotes, setInterviewNotes] = useState('')

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
    enabled: open,
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', branchId],
    queryFn: () => departmentsApi.getAll({ branchId }),
    enabled: !!branchId && open,
  })

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts', branchId],
    queryFn: () => shiftsApi.getAll(branchId),
    enabled: !!branchId && open,
  })

  const mutation = useMutation({
    mutationFn: () =>
      recruitmentApi.accept(application!.id, {
        selectedBranchId: branchId,
        selectedDeptId: deptId,
        selectedDesignation: designation,
        selectedSalary: salary,
        shiftId: shiftId || undefined,
        interviewNotes: interviewNotes || undefined,
      }),
    onSuccess: (data) => {
      toast({ title: 'Candidate accepted as TRAINEE' })
      queryClient.invalidateQueries({ queryKey: ['recruitment'] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      onOpenChange(false)
      onAccepted(data)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to accept candidate',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Accept {application?.fullName} as Employee
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Branch *</Label>
            <Select
              value={branchId}
              onValueChange={(v) => {
                setBranchId(v)
                setDeptId('')
                setShiftId('')
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
            <Label>Department *</Label>
            <Select value={deptId} onValueChange={setDeptId} disabled={!branchId}>
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
            <Label>Designation *</Label>
            <Input value={designation} onChange={(e) => setDesignation(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Shift</Label>
            <Select value={shiftId} onValueChange={setShiftId} disabled={!branchId}>
              <SelectTrigger>
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
              <SelectContent>
                {shifts.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.startTime} - {s.endTime})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Basic Stipend *</Label>
            <PKRInput value={salary} onChange={setSalary} />
          </div>
          <div className="space-y-2">
            <Label>Interview Notes</Label>
            <Textarea
              value={interviewNotes}
              onChange={(e) => setInterviewNotes(e.target.value)}
            />
          </div>

          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="space-y-1 p-4 text-sm">
              <p className="font-medium text-amber-900">
                Employee will be created as TRAINEE
              </p>
              <p className="text-amber-800">
                Temporary password: will be employee code
              </p>
              <p className="text-amber-800">
                Appointment letter required before activation
              </p>
            </CardContent>
          </Card>
        </div>
        <DialogFooter>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={
              !branchId ||
              !deptId ||
              !designation ||
              salary <= 0 ||
              mutation.isPending
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Creating...' : 'Accept Candidate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SuccessDialog({
  result,
  open,
  onOpenChange,
}: {
  result: { employee: { id: string; employeeCode: string }; temporaryPassword: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()

  if (!result) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Employee Created Successfully</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            <span className="text-text-secondary">Employee Code:</span>{' '}
            <strong className="font-mono">{result.employee.employeeCode}</strong>
          </p>
          <p>
            <span className="text-text-secondary">Temporary Password:</span>{' '}
            <strong className="font-mono">{result.temporaryPassword}</strong>
          </p>
        </div>
        <DialogFooter>
          <Button
            className="bg-primary hover:bg-primary-dark"
            onClick={() => {
              onOpenChange(false)
              navigate(`/employees/${result.employee.id}`)
            }}
          >
            Go to Employee Profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ApplicationsTab({
  applications,
  onReject,
  onShortlist,
}: {
  applications: JobApplication[]
  onShortlist: (id: string) => void
  onReject: (id: string) => void
}) {
  const applied = applications.filter((a) => a.status === 'APPLIED')

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Position</TableHead>
          <TableHead>Phone</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Applied On</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {applied.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-text-secondary">
              No applications pending review
            </TableCell>
          </TableRow>
        ) : (
          applied.map((app) => (
            <TableRow key={app.id}>
              <TableCell className="font-medium">{app.fullName}</TableCell>
              <TableCell>{app.position}</TableCell>
              <TableCell>{app.phone}</TableCell>
              <TableCell>{app.email}</TableCell>
              <TableCell>
                {format(parseISO(app.appliedAt), 'dd/MM/yyyy')}
              </TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => onShortlist(app.id)}>
                    Shortlist
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => onReject(app.id)}
                  >
                    Reject
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

function InterviewsTab({
  applications,
  onSchedule,
  onAccept,
  onReject,
}: {
  applications: JobApplication[]
  onSchedule: (app: JobApplication) => void
  onAccept: (app: JobApplication) => void
  onReject: (id: string) => void
}) {
  const interviews = applications.filter(
    (a) => a.status === 'SHORTLISTED' || a.status === 'INTERVIEW_SCHEDULED',
  )

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Position</TableHead>
          <TableHead>Phone</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Interview Date</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {interviews.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-text-secondary">
              No candidates in interview pipeline
            </TableCell>
          </TableRow>
        ) : (
          interviews.map((app) => (
            <TableRow key={app.id}>
              <TableCell className="font-medium">{app.fullName}</TableCell>
              <TableCell>{app.position}</TableCell>
              <TableCell>{app.phone}</TableCell>
              <TableCell>
                <Badge variant="outline" className={statusBadgeClass(app.status)}>
                  {app.status.replace(/_/g, ' ')}
                </Badge>
              </TableCell>
              <TableCell>
                {app.interviewDate
                  ? format(parseISO(app.interviewDate), 'dd/MM/yyyy HH:mm')
                  : '—'}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  {app.status === 'SHORTLISTED' && (
                    <Button size="sm" onClick={() => onSchedule(app)}>
                      Schedule Interview
                    </Button>
                  )}
                  {app.status === 'INTERVIEW_SCHEDULED' && (
                    <>
                      <Button size="sm" onClick={() => onAccept(app)}>
                        Accept Candidate
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => onReject(app.id)}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

function AcceptedTab({
  applications,
  employees,
  branches,
}: {
  applications: JobApplication[]
  employees: Employee[]
  branches: { id: string; name: string }[]
}) {
  const navigate = useNavigate()
  const selected = applications.filter((a) => a.status === 'SELECTED')

  const findEmployee = (app: JobApplication) =>
    employees.find((e) => e.email === app.email)

  const branchName = (id?: string | null) => {
    const branch = branches.find((b) => b.id === id)
    return formatBranchLabel(branch)
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Position</TableHead>
          <TableHead>Employee Code</TableHead>
          <TableHead>Branch</TableHead>
          <TableHead>Designation</TableHead>
          <TableHead>Stipend</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {selected.length === 0 ? (
          <TableRow>
            <TableCell colSpan={8} className="text-text-secondary">
              No accepted candidates yet
            </TableCell>
          </TableRow>
        ) : (
          selected.map((app) => {
            const emp = findEmployee(app)
            return (
              <TableRow key={app.id}>
                <TableCell className="font-medium">{app.fullName}</TableCell>
                <TableCell>{app.position}</TableCell>
                <TableCell className="font-mono text-xs">
                  {emp?.employeeCode ?? '—'}
                </TableCell>
                <TableCell>
                  {branchName(app.selectedBranchId ?? emp?.currentBranchId)}
                </TableCell>
                <TableCell>
                  {app.selectedDesignation ?? emp?.currentDesignation ?? '—'}
                </TableCell>
                <TableCell>
                  {app.selectedSalary
                    ? `PKR ${Number(app.selectedSalary).toLocaleString('en-PK')}`
                    : '—'}
                </TableCell>
                <TableCell>
                  {emp ? (
                    <StatusBadge status={emp.status} />
                  ) : (
                    <Badge variant="outline">TRAINEE</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {emp && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/employees/${emp.id}`)}
                    >
                      View Employee Profile
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )
          })
        )}
      </TableBody>
    </Table>
  )
}

export function RecruitmentPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('applications')
  const [scheduleApp, setScheduleApp] = useState<JobApplication | null>(null)
  const [acceptApp, setAcceptApp] = useState<JobApplication | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [successResult, setSuccessResult] = useState<{
    employee: { id: string; employeeCode: string }
    temporaryPassword: string
  } | null>(null)

  const { data: applications = [], isLoading } = useQuery({
    queryKey: ['recruitment'],
    queryFn: () => recruitmentApi.getAll(),
  })

  const { data: employees = [] } = useQuery({
    queryKey: ['employees-all'],
    queryFn: () => employeesApi.getAll({}),
  })

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const statusMutation = useMutation({
    mutationFn: ({
      id,
      status,
      interviewDate,
      notes,
    }: {
      id: string
      status: string
      interviewDate?: string
      notes?: string
    }) =>
      recruitmentApi.updateStatus(id, {
        status,
        interviewDate,
        notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recruitment'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Action failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const handleShortlist = (id: string) => {
    statusMutation.mutate(
      { id, status: 'SHORTLISTED' },
      {
        onSuccess: () => {
          toast({ title: 'Candidate shortlisted' })
          setTab('interviews')
        },
      },
    )
  }

  const handleReject = (id: string) => setRejectId(id)

  const confirmReject = () => {
    if (!rejectId) return
    statusMutation.mutate(
      { id: rejectId, status: 'REJECTED' },
      {
        onSuccess: () => {
          toast({ title: 'Application rejected' })
          setRejectId(null)
        },
      },
    )
  }

  const counts = useMemo(
    () => ({
      applied: applications.filter((a) => a.status === 'APPLIED').length,
      interviews: applications.filter(
        (a) => a.status === 'SHORTLISTED' || a.status === 'INTERVIEW_SCHEDULED',
      ).length,
      accepted: applications.filter((a) => a.status === 'SELECTED').length,
    }),
    [applications],
  )

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">Recruitment</h1>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Applications', value: counts.applied },
          { label: 'Interviews', value: counts.interviews },
          { label: 'Accepted', value: counts.accepted },
        ].map((card) => (
          <Card key={card.label}>
            <CardContent className="p-4">
              <p className="text-2xl font-bold">{card.value}</p>
              <p className="text-sm text-text-secondary">{card.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="applications">Applications</TabsTrigger>
          <TabsTrigger value="interviews">Interviews</TabsTrigger>
          <TabsTrigger value="accepted">Accepted</TabsTrigger>
        </TabsList>

        <TabsContent value="applications" className="mt-4">
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <div className="rounded-lg border border-border bg-white">
              <ApplicationsTab
                applications={applications}
                onShortlist={handleShortlist}
                onReject={handleReject}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="interviews" className="mt-4">
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <div className="rounded-lg border border-border bg-white">
              <InterviewsTab
                applications={applications}
                onSchedule={setScheduleApp}
                onAccept={setAcceptApp}
                onReject={handleReject}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="accepted" className="mt-4">
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <div className="rounded-lg border border-border bg-white">
              <AcceptedTab
                applications={applications}
                employees={employees}
                branches={branches}
              />
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ScheduleInterviewDialog
        application={scheduleApp}
        open={!!scheduleApp}
        onOpenChange={(v) => !v && setScheduleApp(null)}
      />

      <AcceptCandidateDialog
        application={acceptApp}
        open={!!acceptApp}
        onOpenChange={(v) => !v && setAcceptApp(null)}
        onAccepted={(result) => {
          setSuccessResult(result)
          setTab('accepted')
        }}
      />

      <SuccessDialog
        result={successResult}
        open={!!successResult}
        onOpenChange={(v) => !v && setSuccessResult(null)}
      />

      <ConfirmDialog
        open={!!rejectId}
        title="Reject Application"
        description="Are you sure you want to reject this candidate?"
        confirmLabel="Reject"
        confirmVariant="destructive"
        loading={statusMutation.isPending}
        onConfirm={confirmReject}
        onCancel={() => setRejectId(null)}
      />
    </div>
  )
}
