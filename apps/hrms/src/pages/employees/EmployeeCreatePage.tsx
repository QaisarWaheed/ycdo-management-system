import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { GraduationCap, Plus, Trash2, Upload, UserPlus, Users, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { previousEmploymentApi } from '@/api/endpoints/previousEmployment'
import { qualificationsApi } from '@/api/endpoints/qualifications'
import { shiftsApi } from '@/api/endpoints/shifts'
import { CnicInput } from '@/components/common/CnicInput'
import { DesignationSearchSelect } from '@/components/common/DesignationSearchSelect'
import { PhoneInput } from '@/components/common/PhoneInput'
import { TextOnlyInput } from '@/components/common/TextOnlyInput'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { DocumentType, EmployeePrefill, Gender, QualType, StaffType } from '@/types'

const cnicRegex = /^\d{5}-\d{7}-\d{1}$/
const phoneOptional = z
  .string()
  .optional()
  .refine((v) => !v || /^0\d{10}$/.test(v), 'Must be 11 digits starting with 0')

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const

const STAFF_TYPE_OPTIONS: {
  value: StaffType
  label: string
  description: string
  icon: typeof UserPlus
}[] = [
  {
    value: 'NEW',
    label: 'New Staff',
    description: 'Adding a new employee to YCDO',
    icon: UserPlus,
  },
  {
    value: 'EXISTING',
    label: 'Existing Staff',
    description: 'Staff member already worked at YCDO before',
    icon: Users,
  },
  {
    value: 'INTERNEE',
    label: 'Internee',
    description: 'Adding an intern or trainee',
    icon: GraduationCap,
  },
]

const step1Schema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  fatherName: z.string().optional(),
  fatherContactNumber: phoneOptional,
  cnic: z
    .string()
    .min(1, 'CNIC is required')
    .regex(cnicRegex, 'Format: 12345-1234567-1'),
  dateOfBirth: z.string().optional(),
  phone: phoneOptional,
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  emergencyContactName: z.string().optional(),
  emergencyContactNumber: phoneOptional,
  spouseName: z.string().optional(),
  spouseContactNumber: phoneOptional,
  bloodGroup: z.string().optional(),
  caste: z.string().optional(),
  domicile: z.string().optional(),
  district: z.string().optional(),
  tehsil: z.string().optional(),
  policeStation: z.string().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  currentAddress: z.string().optional(),
  permanentAddress: z.string().optional(),
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
  basicStipend: z
    .number({ error: 'Basic stipend is required' })
    .positive('Stipend must be greater than 0'),
})

type Step1Values = z.infer<typeof step1Schema>
type Step2Values = z.infer<typeof step2Schema>
type Step3Values = z.infer<typeof step3Schema>

interface QualRow {
  key: string
  degree: string
  boardUniversity: string
  obtainedMarks: string
  divisionGrade: string
  qualType: QualType
}

interface PrevEmpRow {
  key: string
  organizationName: string
  ownerAdminName: string
  contactNumber: string
  postalAddress: string
  totalExperience: string
}

function MultiFileUpload({
  label,
  subLabel,
  files,
  onAdd,
  onRemove,
  addButtonLabel = 'Add Another Certificate',
}: {
  label: string
  subLabel: string
  files: File[]
  onAdd: (file: File) => void
  onRemove: (index: number) => void
  addButtonLabel?: string
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-text-secondary">{subLabel}</p>
      </div>
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-surface p-4 transition-colors hover:bg-muted">
        <Upload className="h-6 w-6 text-text-secondary" />
        <span className="text-sm text-text-secondary">Click or drag file to upload</span>
        <input
          type="file"
          className="hidden"
          accept=".jpg,.jpeg,.png,.pdf"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onAdd(file)
            e.target.value = ''
          }}
        />
      </label>
      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
            >
              <span className="truncate">{file.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRemove(index)}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          document
            .getElementById(`multi-upload-${label.replace(/\s/g, '-')}`)
            ?.click()
        }
      >
        <Plus className="mr-1 h-4 w-4" />
        {addButtonLabel}
      </Button>
      <input
        id={`multi-upload-${label.replace(/\s/g, '-')}`}
        type="file"
        className="hidden"
        accept=".jpg,.jpeg,.png,.pdf"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onAdd(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}

const STEPS = [
  { num: 1, label: 'Personal Info' },
  { num: 2, label: 'Job Info' },
  { num: 3, label: 'Stipend & Documents' },
  { num: 4, label: 'Qualifications & Experience' },
]

function StepIndicator({ step }: { step: number }) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-center">
        {STEPS.map((s, i) => (
          <div key={s.num} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold',
                  step === s.num
                    ? 'bg-primary text-white'
                    : step > s.num
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-text-secondary',
                )}
              >
                {s.num}
              </div>
              <span
                className={cn(
                  'hidden max-w-[5rem] text-center text-xs sm:block',
                  step === s.num
                    ? 'font-medium text-primary'
                    : 'text-text-secondary',
                )}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  'mx-1 h-0.5 w-8 sm:mx-2 sm:w-16',
                  step > s.num ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
          </div>
        ))}
      </div>
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

function emptyQualRow(qualType: QualType): QualRow {
  return {
    key: crypto.randomUUID(),
    degree: '',
    boardUniversity: '',
    obtainedMarks: '',
    divisionGrade: '',
    qualType,
  }
}

function emptyPrevEmpRow(): PrevEmpRow {
  return {
    key: crypto.randomUUID(),
    organizationName: '',
    ownerAdminName: '',
    contactNumber: '',
    postalAddress: '',
    totalExperience: '',
  }
}

function buildStep1Payload(data: Step1Values) {
  const optionalKeys = [
    'fatherName',
    'fatherContactNumber',
    'phone',
    'email',
    'dateOfBirth',
    'emergencyContactName',
    'emergencyContactNumber',
    'spouseName',
    'spouseContactNumber',
    'bloodGroup',
    'caste',
    'domicile',
    'district',
    'tehsil',
    'policeStation',
    'currentAddress',
    'permanentAddress',
  ] as const

  const payload: Record<string, unknown> = {
    firstName: data.firstName,
    lastName: data.lastName,
    cnic: data.cnic,
    gender: data.gender,
  }

  for (const key of optionalKeys) {
    const val = data[key]
    if (val) payload[key] = val
  }

  return payload
}

export function EmployeeCreatePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const prefill = (location.state as { prefill?: EmployeePrefill } | null)
    ?.prefill

  const [step, setStep] = useState(0)
  const [staffType, setStaffType] = useState<StaffType | null>(null)
  const [step1Data, setStep1Data] = useState<Step1Values | null>(null)
  const [step2Data, setStep2Data] = useState<Step2Values | null>(null)
  const [step3Data, setStep3Data] = useState<Step3Values | null>(null)
  const [cnicFront, setCnicFront] = useState<File | null>(null)
  const [cnicBack, setCnicBack] = useState<File | null>(null)
  const [educationalCerts, setEducationalCerts] = useState<File[]>([])
  const [medicalCerts, setMedicalCerts] = useState<File[]>([])
  const [docErrors, setDocErrors] = useState<string | null>(null)
  const [qualifications, setQualifications] = useState<QualRow[]>([])
  const [previousEmployments, setPreviousEmployments] = useState<PrevEmpRow[]>(
    [],
  )

  const form1 = useForm<Step1Values>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      firstName: '',
      lastName: '',
      fatherName: '',
      fatherContactNumber: '',
      cnic: '',
      dateOfBirth: '',
      phone: '',
      email: '',
      emergencyContactName: '',
      emergencyContactNumber: '',
      spouseName: '',
      spouseContactNumber: '',
      bloodGroup: '',
      caste: '',
      domicile: '',
      district: '',
      tehsil: '',
      policeStation: '',
      gender: 'MALE',
      currentAddress: '',
      permanentAddress: '',
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
    defaultValues: { basicStipend: 0 },
  })

  const branchId = form2.watch('currentBranchId')

  useEffect(() => {
    if (prefill) {
      form1.reset({
        firstName: prefill.firstName ?? '',
        lastName: prefill.lastName ?? '',
        fatherName: '',
        fatherContactNumber: '',
        cnic: prefill.cnic ?? '',
        phone: prefill.phone ?? '',
        email: prefill.email ?? '',
        dateOfBirth: '',
        emergencyContactName: '',
        emergencyContactNumber: '',
        spouseName: '',
        spouseContactNumber: '',
        bloodGroup: '',
        caste: '',
        domicile: '',
        district: '',
        tehsil: '',
        policeStation: '',
        gender: 'MALE',
        currentAddress: '',
        permanentAddress: '',
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
    mutationFn: async () => {
      if (!step1Data || !step2Data || !step3Data || !staffType) {
        throw new Error('Missing form data')
      }

      const employee = await employeesApi.create({
        ...buildStep1Payload(step1Data),
        ...step2Data,
        ...step3Data,
        staffType,
        biometricId: step2Data.biometricId || undefined,
        shiftId: step2Data.shiftId || undefined,
      })

      const uploadFile = async (
        file: File,
        documentType: DocumentType,
        namePrefix?: string,
      ) => {
        const formData = new FormData()
        formData.append('documentType', documentType)
        const uploadName = namePrefix ? `${namePrefix}-${file.name}` : file.name
        formData.append('file', file, uploadName)
        await employeesApi.uploadDocument(employee.id, formData)
      }

      if (cnicFront) await uploadFile(cnicFront, 'CNIC', 'cnic-front')
      if (cnicBack) await uploadFile(cnicBack, 'CNIC', 'cnic-back')
      for (const file of educationalCerts) {
        await uploadFile(file, 'EDUCATIONAL_CERTIFICATE')
      }
      for (const file of medicalCerts) {
        await uploadFile(file, 'MEDICAL_CERTIFICATE')
      }

      for (const qual of qualifications) {
        if (!qual.degree.trim() || !qual.boardUniversity.trim()) continue
        await qualificationsApi.create({
          employeeId: employee.id,
          qualType: qual.qualType,
          degree: qual.degree,
          boardUniversity: qual.boardUniversity,
          obtainedMarks: qual.obtainedMarks || undefined,
          divisionGrade: qual.divisionGrade || undefined,
        })
      }

      for (const emp of previousEmployments) {
        if (!emp.organizationName.trim()) continue
        await previousEmploymentApi.create({
          employeeId: employee.id,
          organizationName: emp.organizationName,
          ownerAdminName: emp.ownerAdminName || undefined,
          contactNumber: emp.contactNumber || undefined,
          postalAddress: emp.postalAddress || undefined,
          totalExperience: emp.totalExperience || undefined,
        })
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

  const onStep3Next = form3.handleSubmit((data) => {
    if (!cnicFront || !cnicBack) {
      setDocErrors('CNIC front and back are both required')
      return
    }
    setDocErrors(null)
    setStep3Data(data)
    setStep(4)
  })

  const onSubmit = () => {
    createMutation.mutate()
  }

  const updateQual = (key: string, field: keyof QualRow, value: string) => {
    setQualifications((prev) =>
      prev.map((q) => (q.key === key ? { ...q, [field]: value } : q)),
    )
  }

  const updatePrevEmp = (
    key: string,
    field: keyof PrevEmpRow,
    value: string,
  ) => {
    setPreviousEmployments((prev) =>
      prev.map((e) => (e.key === key ? { ...e, [field]: value } : e)),
    )
  }

  const renderQualTable = (qualType: QualType, title: string) => {
    const rows = qualifications.filter((q) => q.qualType === qualType)
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setQualifications((prev) => [...prev, emptyQualRow(qualType)])
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Qualification
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-text-secondary">No qualifications added</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Degree</TableHead>
                  <TableHead>Board / University</TableHead>
                  <TableHead>Marks</TableHead>
                  <TableHead>Division / Grade</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <Input
                        value={row.degree}
                        onChange={(e) =>
                          updateQual(row.key, 'degree', e.target.value)
                        }
                        placeholder="e.g. BSc"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.boardUniversity}
                        onChange={(e) =>
                          updateQual(row.key, 'boardUniversity', e.target.value)
                        }
                        placeholder="Board / University"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.obtainedMarks}
                        onChange={(e) =>
                          updateQual(row.key, 'obtainedMarks', e.target.value)
                        }
                        placeholder="Marks"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.divisionGrade}
                        onChange={(e) =>
                          updateQual(row.key, 'divisionGrade', e.target.value)
                        }
                        placeholder="Division / Grade"
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setQualifications((prev) =>
                            prev.filter((q) => q.key !== row.key),
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">Add Employee</h1>

      {step === 0 && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold">
            What type of staff are you adding?
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {STAFF_TYPE_OPTIONS.map((option) => {
              const Icon = option.icon
              const selected = staffType === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStaffType(option.value)}
                  className={cn(
                    'flex flex-col items-center gap-3 rounded-lg border-2 p-6 text-center transition-colors',
                    selected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-10 w-10',
                      selected ? 'text-primary' : 'text-text-secondary',
                    )}
                  />
                  <div>
                    <p className="font-semibold">{option.label}</p>
                    <p className="mt-1 text-xs text-text-secondary">
                      {option.description}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
          {staffType && (
            <div className="flex justify-end">
              <Button
                type="button"
                className="bg-primary hover:bg-primary-dark"
                onClick={() => setStep(1)}
              >
                Continue
              </Button>
            </div>
          )}
        </div>
      )}

      {step >= 1 && <StepIndicator step={step} />}

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
                      <TextOnlyInput {...field} />
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
                      <TextOnlyInput {...field} />
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
                      <TextOnlyInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="fatherContactNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Father Contact Number</FormLabel>
                    <FormControl>
                      <PhoneInput
                        value={field.value}
                        onChange={field.onChange}
                      />
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
                      <CnicInput value={field.value} onChange={field.onChange} />
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
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <PhoneInput
                        value={field.value}
                        onChange={field.onChange}
                      />
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
                name="emergencyContactName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Emergency Contact Name</FormLabel>
                    <FormControl>
                      <TextOnlyInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="emergencyContactNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Emergency Contact Number</FormLabel>
                    <FormControl>
                      <PhoneInput
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="spouseName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Spouse Name</FormLabel>
                    <FormControl>
                      <TextOnlyInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="spouseContactNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Spouse Contact Number</FormLabel>
                    <FormControl>
                      <PhoneInput
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="bloodGroup"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Blood Group</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select blood group" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {BLOOD_GROUPS.map((bg) => (
                          <SelectItem key={bg} value={bg}>
                            {bg}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="caste"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Caste</FormLabel>
                    <FormControl>
                      <TextOnlyInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="domicile"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Domicile</FormLabel>
                    <FormControl>
                      <TextOnlyInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="district"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>District</FormLabel>
                    <FormControl>
                      <TextOnlyInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="tehsil"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tehsil</FormLabel>
                    <FormControl>
                      <TextOnlyInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="policeStation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Police Station</FormLabel>
                    <FormControl>
                      <TextOnlyInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="gender"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
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
              name="currentAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Address</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form1.control}
              name="permanentAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Permanent Address</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={() => setStep(0)}>
                Back
              </Button>
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
                  <FormItem className="sm:col-span-2">
                    <FormControl>
                      <DesignationSearchSelect
                        value={field.value}
                        onChange={field.onChange}
                        error={!!form2.formState.errors.currentDesignation}
                      />
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
          <form onSubmit={onStep3Next} className="space-y-6">
            <h2 className="text-lg font-semibold">Stipend & Documents</h2>
            <FormField
              control={form3.control}
              name="basicStipend"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Basic Stipend *</FormLabel>
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

            <div className="space-y-6">
              <div>
                <p className="text-sm font-medium">
                  CNIC Documents <span className="text-destructive">*</span>
                </p>
                <p className="text-xs text-text-secondary">
                  Upload front and back separately
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FileDropZone
                  label="CNIC Front *"
                  file={cnicFront}
                  onChange={setCnicFront}
                />
                <FileDropZone
                  label="CNIC Back *"
                  file={cnicBack}
                  onChange={setCnicBack}
                />
              </div>
              {docErrors && (
                <p className="text-sm text-destructive">{docErrors}</p>
              )}

              <MultiFileUpload
                label="Educational Certificates"
                subLabel="Upload all certificates (can add multiple)"
                files={educationalCerts}
                onAdd={(file) =>
                  setEducationalCerts((prev) => [...prev, file])
                }
                onRemove={(index) =>
                  setEducationalCerts((prev) =>
                    prev.filter((_, i) => i !== index),
                  )
                }
              />

              <MultiFileUpload
                label="Medical Certificates"
                subLabel="Upload all medical documents (can add multiple)"
                files={medicalCerts}
                onAdd={(file) => setMedicalCerts((prev) => [...prev, file])}
                onRemove={(index) =>
                  setMedicalCerts((prev) => prev.filter((_, i) => i !== index))
                }
              />
            </div>

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button type="submit" className="bg-primary hover:bg-primary-dark">
                Next
              </Button>
            </div>
          </form>
        </Form>
      )}

      {step === 4 && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold">Qualifications & Experience</h2>

          {renderQualTable('ACADEMIC', 'Academic Qualifications')}
          {renderQualTable('JOB_RELEVANT', 'Job-Relevant Qualifications')}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Previous Employment</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setPreviousEmployments((prev) => [...prev, emptyPrevEmpRow()])
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                Add Previous Employment
              </Button>
            </div>
            {previousEmployments.length === 0 ? (
              <p className="text-sm text-text-secondary">
                No previous employment added
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organization</TableHead>
                      <TableHead>Owner / Admin</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Postal Address</TableHead>
                      <TableHead>Experience</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previousEmployments.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell>
                          <Input
                            value={row.organizationName}
                            onChange={(e) =>
                              updatePrevEmp(
                                row.key,
                                'organizationName',
                                e.target.value,
                              )
                            }
                            placeholder="Organization"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.ownerAdminName}
                            onChange={(e) =>
                              updatePrevEmp(
                                row.key,
                                'ownerAdminName',
                                e.target.value,
                              )
                            }
                            placeholder="Owner / Admin"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.contactNumber}
                            onChange={(e) =>
                              updatePrevEmp(
                                row.key,
                                'contactNumber',
                                e.target.value,
                              )
                            }
                            placeholder="Contact"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.postalAddress}
                            onChange={(e) =>
                              updatePrevEmp(
                                row.key,
                                'postalAddress',
                                e.target.value,
                              )
                            }
                            placeholder="Address"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.totalExperience}
                            onChange={(e) =>
                              updatePrevEmp(
                                row.key,
                                'totalExperience',
                                e.target.value,
                              )
                            }
                            placeholder="e.g. 2 years"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setPreviousEmployments((prev) =>
                                prev.filter((e) => e.key !== row.key),
                              )
                            }
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <Button type="button" variant="outline" onClick={() => setStep(3)}>
              Back
            </Button>
            <Button
              type="button"
              className="bg-primary hover:bg-primary-dark"
              disabled={createMutation.isPending}
              onClick={onSubmit}
            >
              {createMutation.isPending ? 'Creating...' : 'Submit'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
