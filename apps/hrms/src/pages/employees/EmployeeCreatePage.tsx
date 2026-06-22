import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { shiftsApi } from '@/api/endpoints/shifts'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { DocumentType, EmployeePrefill, Gender } from '@/types'
import { DOCUMENT_TYPES } from '@/types'

const cnicRegex = /^\d{5}-\d{7}-\d{1}$/

const step1Schema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  fatherName: z.string().optional(),
  cnic: z
    .string()
    .min(1, 'CNIC is required')
    .regex(cnicRegex, 'Format: 12345-1234567-1'),
  phone: z.string().optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  dateOfBirth: z.string().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  address: z.string().optional(),
})

const step2Schema = z.object({
  currentBranchId: z.string().min(1, 'Branch is required'),
  currentDepartmentId: z.string().min(1, 'Department is required'),
  currentDesignation: z.string().min(1, 'Designation is required'),
  joiningDate: z.string().min(1, 'Joining date is required'),
  biometricId: z.string().optional(),
  shiftId: z.string().optional(),
})

const step3Schema = z.object({
  basicSalary: z
    .number({ error: 'Basic salary is required' })
    .positive('Salary must be greater than 0'),
})

type Step1Values = z.infer<typeof step1Schema>
type Step2Values = z.infer<typeof step2Schema>
type Step3Values = z.infer<typeof step3Schema>

const DOC_LABELS: Record<DocumentType, string> = {
  CNIC: 'CNIC',
  EDUCATIONAL_CERTIFICATE: 'Educational Certificate',
  EXPERIENCE_LETTER: 'Experience Letter',
  MEDICAL_CERTIFICATE: 'Medical Certificate',
  OTHER: 'Other',
}

function StepIndicator({ step }: { step: number }) {
  const steps = [1, 2, 3]
  return (
    <div className="mb-8 flex items-center justify-center">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold',
              step === s
                ? 'bg-primary text-white'
                : step > s
                  ? 'bg-primary/20 text-primary'
                  : 'bg-muted text-text-secondary',
            )}
          >
            {s}
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                'mx-2 h-0.5 w-16 sm:w-24',
                step > s ? 'bg-primary' : 'bg-border',
              )}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function FileDropZone({
  label,
  file,
  onChange,
}: {
  label: string
  file: File | null
  onChange: (file: File | null) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-surface p-4 transition-colors hover:bg-muted">
        <Upload className="h-6 w-6 text-text-secondary" />
        <span className="text-sm text-text-secondary">
          {file ? file.name : 'Click or drag file to upload'}
        </span>
        <input
          type="file"
          className="hidden"
          accept=".jpg,.jpeg,.png,.pdf"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        />
      </label>
    </div>
  )
}

export function EmployeeCreatePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const prefill = (location.state as { prefill?: EmployeePrefill } | null)
    ?.prefill

  const [step, setStep] = useState(1)
  const [step1Data, setStep1Data] = useState<Step1Values | null>(null)
  const [step2Data, setStep2Data] = useState<Step2Values | null>(null)
  const [documents, setDocuments] = useState<
    Partial<Record<DocumentType, File>>
  >({})

  const form1 = useForm<Step1Values>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      firstName: '',
      lastName: '',
      fatherName: '',
      cnic: '',
      phone: '',
      email: '',
      dateOfBirth: '',
      gender: 'MALE',
      address: '',
    },
  })

  const form2 = useForm<Step2Values>({
    resolver: zodResolver(step2Schema),
    defaultValues: {
      currentBranchId: '',
      currentDepartmentId: '',
      currentDesignation: '',
      joiningDate: '',
      biometricId: '',
      shiftId: '',
    },
  })

  const form3 = useForm<Step3Values>({
    resolver: zodResolver(step3Schema),
    defaultValues: { basicSalary: 0 },
  })

  const branchId = form2.watch('currentBranchId')

  useEffect(() => {
    if (prefill) {
      form1.reset({
        firstName: prefill.firstName ?? '',
        lastName: prefill.lastName ?? '',
        fatherName: '',
        cnic: prefill.cnic ?? '',
        phone: prefill.phone ?? '',
        email: prefill.email ?? '',
        dateOfBirth: '',
        gender: 'MALE',
        address: '',
      })
      form2.reset({
        currentBranchId: prefill.branchId ?? '',
        currentDepartmentId: '',
        currentDesignation: prefill.currentDesignation ?? '',
        joiningDate: '',
        biometricId: '',
      })
    }
  }, [prefill, form1, form2])

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', branchId],
    queryFn: () => departmentsApi.getAll({ branchId }),
    enabled: !!branchId,
  })

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts', branchId],
    queryFn: () => shiftsApi.getAll(branchId),
    enabled: !!branchId,
  })

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const employee = await employeesApi.create(payload)
      const uploads = Object.entries(documents).filter(
        (entry): entry is [DocumentType, File] => !!entry[1],
      )
      for (const [docType, file] of uploads) {
        const formData = new FormData()
        formData.append('documentType', docType)
        formData.append('file', file)
        await employeesApi.uploadDocument(employee.id, formData)
      }
      return employee
    },
    onSuccess: (employee) => {
      toast({ title: 'Employee created successfully' })
      navigate(`/employees/${employee.id}`)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to create employee',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const onStep1Next = form1.handleSubmit((data) => {
    setStep1Data(data)
    setStep(2)
  })

  const onStep2Next = form2.handleSubmit((data) => {
    setStep2Data(data)
    setStep(3)
  })

  const onSubmit = form3.handleSubmit((data) => {
    if (!step1Data || !step2Data) return
    createMutation.mutate({
      ...step1Data,
      ...step2Data,
      ...data,
      email: step1Data.email || undefined,
      fatherName: step1Data.fatherName || undefined,
      phone: step1Data.phone || undefined,
      dateOfBirth: step1Data.dateOfBirth || undefined,
      address: step1Data.address || undefined,
      biometricId: step2Data.biometricId || undefined,
      shiftId: step2Data.shiftId || undefined,
    })
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">Add Employee</h1>
      <StepIndicator step={step} />

      {step === 1 && (
        <Form {...form1}>
          <form onSubmit={onStep1Next} className="space-y-6">
            <h2 className="text-lg font-semibold">Personal Information</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form1.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name *</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name *</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="fatherName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Father Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="cnic"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CNIC *</FormLabel>
                    <FormControl>
                      <Input placeholder="12345-1234567-1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="dateOfBirth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date of Birth</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="gender"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gender *</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(['MALE', 'FEMALE', 'OTHER'] as Gender[]).map((g) => (
                          <SelectItem key={g} value={g}>
                            {g.charAt(0) + g.slice(1).toLowerCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form1.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end">
              <Button type="submit" className="bg-primary hover:bg-primary-dark">
                Next
              </Button>
            </div>
          </form>
        </Form>
      )}

      {step === 2 && (
        <Form {...form2}>
          <form onSubmit={onStep2Next} className="space-y-6">
            <h2 className="text-lg font-semibold">Job Information</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form2.control}
                name="currentBranchId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Branch *</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v)
                        form2.setValue('currentDepartmentId', '')
                        form2.setValue('shiftId', '')
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select branch" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form2.control}
                name="currentDepartmentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department *</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={!branchId}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select department" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {departments.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form2.control}
                name="currentDesignation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Designation *</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form2.control}
                name="shiftId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Shift</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={!branchId}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Optional" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {shifts.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name} ({s.startTime} - {s.endTime})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form2.control}
                name="joiningDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Joining Date *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form2.control}
                name="biometricId"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Biometric ID</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button type="submit" className="bg-primary hover:bg-primary-dark">
                Next
              </Button>
            </div>
          </form>
        </Form>
      )}

      {step === 3 && (
        <Form {...form3}>
          <form onSubmit={onSubmit} className="space-y-6">
            <h2 className="text-lg font-semibold">Salary & Documents</h2>
            <FormField
              control={form3.control}
              name="basicSalary"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Basic Salary *</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary">
                        PKR
                      </span>
                      <Input
                        type="number"
                        className="pl-12"
                        {...field}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === '' ? 0 : Number(e.target.value),
                          )
                        }
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-4">
              <p className="text-sm font-medium">Documents (optional)</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {DOCUMENT_TYPES.map((docType) => (
                  <FileDropZone
                    key={docType}
                    label={DOC_LABELS[docType]}
                    file={documents[docType] ?? null}
                    onChange={(file) =>
                      setDocuments((prev) => ({ ...prev, [docType]: file ?? undefined }))
                    }
                  />
                ))}
              </div>
            </div>

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                type="submit"
                className="bg-primary hover:bg-primary-dark"
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? 'Creating...' : 'Submit'}
              </Button>
            </div>
          </form>
        </Form>
      )}
    </div>
  )
}
