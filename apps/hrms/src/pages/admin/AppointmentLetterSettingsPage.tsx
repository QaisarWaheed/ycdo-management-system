import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { lettersApi, type AppointmentCoverageRow, type AppointmentMappingRow } from '@/api/endpoints/letters'
import { departmentsApi } from '@/api/endpoints/departments'
import { designationsApi } from '@/api/endpoints/designations'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'

const ALLOWED = ['SUPER_ADMIN', 'HR_MANAGER', 'HR_ADMIN_MANAGER', 'ADMIN_MANAGER']

type FormState = {
  id?: string
  departmentId: string
  designationId: string
  applyToUnmappedDesignations: boolean
  language: 'EN' | 'UR'
  templateCode: string
  active: boolean
}

const emptyForm: FormState = {
  departmentId: '',
  designationId: '',
  applyToUnmappedDesignations: false,
  language: 'EN',
  templateCode: '',
  active: true,
}

export function AppointmentLetterSettingsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'mappings' | 'coverage'>('mappings')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [formOpen, setFormOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [coverageDept, setCoverageDept] = useState('ALL')
  const [coverageStatus, setCoverageStatus] = useState('ALL')

  const { data: mappings = [], isLoading } = useQuery({
    queryKey: ['appointment-mappings'],
    queryFn: () => lettersApi.listAppointmentMappings(),
  })
  const { data: templates = [] } = useQuery({
    queryKey: ['appointment-mapping-templates'],
    queryFn: () => lettersApi.listAppointmentMappingTemplates(),
  })
  const { data: coverage } = useQuery({
    queryKey: ['appointment-mapping-coverage'],
    queryFn: () => lettersApi.appointmentMappingCoverage(),
  })
  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll(),
  })
  const { data: designations = [] } = useQuery({
    queryKey: ['designations'],
    queryFn: () => designationsApi.getAll(),
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        departmentId: form.departmentId,
        designationId: form.applyToUnmappedDesignations
          ? null
          : form.designationId,
        applyToUnmappedDesignations: form.applyToUnmappedDesignations,
        language: form.language,
        templateCode: form.templateCode,
        active: form.active,
      }
      if (form.id) return lettersApi.updateAppointmentMapping(form.id, payload)
      return lettersApi.createAppointmentMapping(payload)
    },
    onSuccess: () => {
      toast({ title: form.id ? 'Mapping updated' : 'Mapping created' })
      queryClient.invalidateQueries({ queryKey: ['appointment-mappings'] })
      queryClient.invalidateQueries({ queryKey: ['appointment-mapping-coverage'] })
      setFormOpen(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Could not save mapping',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => lettersApi.deleteAppointmentMapping(id),
    onSuccess: () => {
      toast({ title: 'Mapping deactivated or deleted' })
      queryClient.invalidateQueries({ queryKey: ['appointment-mappings'] })
      queryClient.invalidateQueries({ queryKey: ['appointment-mapping-coverage'] })
    },
  })

  const previewMutation = useMutation({
    mutationFn: (row: AppointmentMappingRow) =>
      lettersApi.previewAppointmentMapping({ mappingId: row.id }),
    onSuccess: (data) => setPreviewHtml(data.previewHtml),
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Preview failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const filteredCoverage = useMemo(() => {
    return (coverage?.rows ?? []).filter((row) => {
      if (coverageDept !== 'ALL' && row.department !== coverageDept) return false
      if (coverageStatus !== 'ALL' && row.status !== coverageStatus) return false
      return true
    })
  }, [coverage, coverageDept, coverageStatus])

  if (!user?.role || !ALLOWED.includes(user.role)) {
    return <Navigate to="/dashboard" replace />
  }

  const openCreate = (prefill?: Partial<FormState>) => {
    setForm({ ...emptyForm, ...prefill })
    setFormOpen(true)
  }

  const openFromCoverage = (row: AppointmentCoverageRow) => {
    if (row.status === 'INVALID_ROLE') {
      toast({
        title: 'Invalid role',
        description: 'ADMIN+LAB / ADMINISTRATION cannot be mapped. Correct the employee assignment first.',
        variant: 'destructive',
      })
      return
    }
    openCreate({
      departmentId: row.departmentId ?? '',
      designationId: row.designationId ?? '',
      language: row.language === 'UR' ? 'UR' : 'EN',
      templateCode: row.templateCode ?? '',
    })
    setTab('mappings')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Appointment Letter Settings</h1>
        <p className="text-sm text-text-secondary">
          Urdu appointment letters are issued only to Grade 4 staff and to Repair
          and Development staff except the Biomedical Engineer. All other staff
          receive the English letter. Language follows the selected template
          family.
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          variant={tab === 'mappings' ? 'default' : 'outline'}
          onClick={() => setTab('mappings')}
        >
          Template Mappings
        </Button>
        <Button
          variant={tab === 'coverage' ? 'default' : 'outline'}
          onClick={() => setTab('coverage')}
        >
          Mapping Coverage
        </Button>
      </div>

      {tab === 'mappings' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Template Mappings</CardTitle>
            <Button onClick={() => openCreate()}>Add mapping</Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Template Family</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6}>Loading…</TableCell>
                  </TableRow>
                ) : mappings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-text-secondary">
                      No mappings yet
                    </TableCell>
                  </TableRow>
                ) : (
                  mappings.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.department?.name ?? '—'}</TableCell>
                      <TableCell>
                        {row.designation?.title ??
                          'All unmapped designations'}
                      </TableCell>
                      <TableCell>{row.language}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.templateCode}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.active ? 'default' : 'outline'}>
                          {row.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => previewMutation.mutate(row)}
                        >
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setForm({
                              id: row.id,
                              departmentId: row.departmentId ?? '',
                              designationId: row.designationId ?? '',
                              applyToUnmappedDesignations: !row.designationId,
                              language: row.language,
                              templateCode: row.templateCode,
                              active: row.active,
                            })
                            setFormOpen(true)
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            lettersApi
                              .updateAppointmentMapping(row.id, {
                                active: !row.active,
                              })
                              .then(() => {
                                queryClient.invalidateQueries({
                                  queryKey: ['appointment-mappings'],
                                })
                                queryClient.invalidateQueries({
                                  queryKey: ['appointment-mapping-coverage'],
                                })
                              })
                          }
                        >
                          {row.active ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => deleteMutation.mutate(row.id)}
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === 'coverage' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-5">
            <SummaryCard label="Combinations" value={coverage?.summary.total ?? 0} />
            <SummaryCard label="Mapped" value={coverage?.summary.mapped ?? 0} />
            <SummaryCard
              label="Missing mapping"
              value={coverage?.summary.missingMapping ?? 0}
            />
            <SummaryCard
              label="Invalid catalog"
              value={coverage?.summary.missingCatalog ?? 0}
            />
            <SummaryCard
              label="Inactive mapping"
              value={coverage?.summary.inactiveMapping ?? 0}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <select
              className="rounded border px-2 py-1 text-sm"
              value={coverageDept}
              onChange={(e) => setCoverageDept(e.target.value)}
            >
              <option value="ALL">All departments</option>
              {[...new Set((coverage?.rows ?? []).map((r) => r.department))].map(
                (name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ),
              )}
            </select>
            <select
              className="rounded border px-2 py-1 text-sm"
              value={coverageStatus}
              onChange={(e) => setCoverageStatus(e.target.value)}
            >
              <option value="ALL">All statuses</option>
              <option value="MAPPED">MAPPED</option>
              <option value="MISSING_MAPPING">MISSING_MAPPING</option>
              <option value="MISSING_DESIGNATION_CATALOG">
                MISSING_DESIGNATION_CATALOG
              </option>
              <option value="INVALID_ROLE">INVALID_ROLE</option>
              <option value="INACTIVE_MAPPING">INACTIVE_MAPPING</option>
            </select>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Department</TableHead>
                    <TableHead>Designation</TableHead>
                    <TableHead>Employees</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Template</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCoverage.map((row) => (
                    <TableRow
                      key={`${row.departmentId}-${row.designation}`}
                      className={
                        row.status === 'MISSING_MAPPING' ||
                        row.status === 'INVALID_ROLE'
                          ? 'bg-red-50'
                          : undefined
                      }
                    >
                      <TableCell>{row.department}</TableCell>
                      <TableCell>{row.designation}</TableCell>
                      <TableCell>{row.employeeCount}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.status === 'MAPPED' ? 'default' : 'outline'
                          }
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.templateCode ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openFromCoverage(row)}
                        >
                          Create Mapping
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit mapping' : 'Add mapping'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Department</Label>
              <select
                className="w-full rounded border px-2 py-2 text-sm"
                value={form.departmentId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, departmentId: e.target.value }))
                }
              >
                <option value="">Select department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.applyToUnmappedDesignations}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    applyToUnmappedDesignations: e.target.checked,
                    designationId: e.target.checked ? '' : f.designationId,
                  }))
                }
              />
              Applies to all unmapped designations in this department
            </label>
            {!form.applyToUnmappedDesignations && (
              <div className="space-y-1">
                <Label>Designation</Label>
                <select
                  className="w-full rounded border px-2 py-2 text-sm"
                  value={form.designationId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, designationId: e.target.value }))
                  }
                >
                  <option value="">Select designation</option>
                  {designations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <Label>Template family</Label>
              <select
                className="w-full rounded border px-2 py-2 text-sm"
                value={form.templateCode}
                onChange={(e) => {
                  const code = e.target.value
                  const tpl = templates.find((t) => t.code === code)
                  setForm((f) => ({
                    ...f,
                    templateCode: code,
                    language: tpl?.language === 'UR' ? 'UR' : 'EN',
                  }))
                }}
              >
                <option value="">Select template</option>
                {templates.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.familyName ?? t.name} ({t.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Language</Label>
              <Input value={form.language} readOnly />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) =>
                  setForm((f) => ({ ...f, active: e.target.checked }))
                }
              />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewHtml} onOpenChange={() => setPreviewHtml(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Appointment preview (DRAFT watermark)</DialogTitle>
          </DialogHeader>
          {previewHtml && (
            <iframe
              title="Appointment mapping preview"
              className="h-[70vh] w-full rounded border"
              srcDoc={previewHtml}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-text-secondary">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}
