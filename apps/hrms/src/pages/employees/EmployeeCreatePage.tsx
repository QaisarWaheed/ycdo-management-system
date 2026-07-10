import { Component, useEffect, useMemo, useState, type ErrorInfo, type FormEvent, type ReactNode } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { GraduationCap, Plus, Trash2, Upload, UserPlus, Users, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import type { Control, FieldValues, UseFormSetValue } from 'react-hook-form'
import { useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { projectsApi } from '@/api/endpoints/projects'
import { previousEmploymentApi } from '@/api/endpoints/previousEmployment'
import { qualificationsApi } from '@/api/endpoints/qualifications'
import { designationsApi } from '@/api/endpoints/designations'
import { DateInput } from '@/components/common/DateInput'
import { PhoneInput } from '@/components/common/PhoneInput'
import { CnicInput } from '@/components/common/CnicInput'
import { SearchableSelect } from '@/components/common/SearchableSelect'
import { EmployeeLocationFields } from '@/components/employees/EmployeeLocationFields'
import { DutyHoursFields } from '@/components/employees/DutyHoursFields'
import { getDesignationCategoriesForDepartment } from '@/lib/departmentCategoryMapping'
import { findDepartmentByName } from '@/lib/inlineMasterData'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import {
  BLOOD_GROUP_OPTIONS,
  FATHER_STATUS_LABELS,
  GENDER_OPTIONS,
  genderToLabel,
  labelToFatherStatus,
  labelToGender,
  labelToMaritalStatus,
  MARITAL_STATUS_LABELS,
  maritalStatusToLabel,
  SHIFT_NAME_OPTIONS,
  fatherStatusToLabel,
} from '@/lib/searchableSelectOptions'
import { getStartTimeOptionsForShift } from '@/lib/dutyTimes'
import { StipendPackageFields } from '@/components/payroll/StipendPackageFields'
import { DEFAULT_STIPEND_VALUES } from '@/lib/stipendUtils'
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
import { Label } from '@/components/ui/label'
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
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import type { DocumentType, EmployeePrefill, QualType, StaffType } from '@/types'

const cnicRegex = /^\d{5}-\d{7}-\d{1}$/
const phoneOptional = z
  .string()
  .optional()
  .refine((v) => !v || /^0\d{10}$/.test(v), 'Must be 11 digits starting with 0')

const phoneRequired = z
  .string()
  .min(1, 'Phone number is required')
  .refine((v) => /^0\d{10}$/.test(v), 'Must be 11 digits starting with 0')

const SHIFT_OPTIONS = SHIFT_NAME_OPTIONS

const BLOOD_GROUPS = BLOOD_GROUP_OPTIONS

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

const newStaffStep1Schema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  fatherName: z.string().min(1, 'Father name is required'),
  fatherStatus: z.enum(['ALIVE', 'DECEASED']).optional(),
  fatherContactNumber: phoneRequired,
  guardianContact: phoneOptional,
  cnic: z
    .string()
    .min(1, 'CNIC is required')
    .regex(cnicRegex, 'Format: 12345-1234567-1'),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  phone: phoneRequired,
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  maritalStatus: z
    .enum(['MARRIED', 'UNMARRIED', 'DIVORCED', 'WIDOW'])
    .optional(),
  emergencyContactName: z.string().min(1, 'Emergency contact name is required'),
  emergencyRelation: z.string().optional(),
  emergencyContactNumber: phoneRequired,
  spouseName: z.string().optional(),
  spouseContactNumber: phoneOptional,
  bloodGroup: z.string().min(1, 'Blood group is required'),
  caste: z.string().optional(),
  domicile: z.string().min(1, 'Domicile is required'),
  province: z.string().min(1, 'Province is required'),
  city: z.string().min(1, 'City is required'),
  permanentProvince: z.string().min(1, 'Permanent province is required'),
  permanentCity: z.string().min(1, 'Permanent city is required'),
  district: z.string().min(1, 'District is required'),
  tehsil: z.string().min(1, 'Tehsil is required'),
  policeStation: z.string().min(1, 'Police station is required'),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  currentAddress: z.string().min(1, 'Current address is required'),
  permanentAddress: z.string().min(1, 'Permanent address is required'),
})

const existingStaffStep1Schema = z
  .object({
    fullName: z.string().min(1, 'Full name is required'),
    fatherName: z.string().min(1, 'Father name is required'),
    fatherStatus: z.enum(['ALIVE', 'DECEASED'], {
      message: 'Father status is required',
    }),
    fatherContactNumber: phoneOptional,
    guardianContact: phoneOptional,
    cnic: z
      .string()
      .min(1, 'CNIC is required')
      .regex(cnicRegex, 'Format: 12345-1234567-1'),
    dateOfBirth: z.string().min(1, 'Date of birth is required'),
    phone: phoneRequired,
    email: z.string().email('Invalid email').optional().or(z.literal('')),
    maritalStatus: z.enum(['MARRIED', 'UNMARRIED', 'DIVORCED', 'WIDOW'], {
      message: 'Marital status is required',
    }),
    emergencyContactName: z.string().min(1, 'Emergency contact name is required'),
    emergencyRelation: z.string().min(1, 'Emergency relation is required'),
    emergencyContactNumber: phoneRequired,
    spouseName: z.string().optional(),
    spouseContactNumber: phoneOptional,
    bloodGroup: z.string().min(1, 'Blood group is required'),
    caste: z.string().optional(),
    domicile: z.string().optional(),
    province: z.string().min(1, 'Province is required'),
    city: z.string().min(1, 'City is required'),
    permanentProvince: z.string().optional(),
    permanentCity: z.string().optional(),
    district: z.string().optional(),
    tehsil: z.string().optional(),
    policeStation: z.string().optional(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
    currentAddress: z.string().min(1, 'Current address is required'),
    permanentAddress: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.fatherStatus === 'ALIVE') {
      if (!data.fatherContactNumber || !/^0\d{10}$/.test(data.fatherContactNumber)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Father contact number is required',
          path: ['fatherContactNumber'],
        })
      }
    }
    if (data.fatherStatus === 'DECEASED') {
      if (!data.guardianContact || !/^0\d{10}$/.test(data.guardianContact)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Guardian contact is required',
          path: ['guardianContact'],
        })
      }
    }
    if (data.maritalStatus === 'MARRIED') {
      if (!data.spouseName?.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: 'Spouse name is required',
          path: ['spouseName'],
        })
      }
      if (!data.spouseContactNumber || !/^0\d{10}$/.test(data.spouseContactNumber)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Spouse contact number is required',
          path: ['spouseContactNumber'],
        })
      }
    }
  })


const step1FormSchema = z.object({
  fullName: z.string(),
  fatherName: z.string(),
  fatherStatus: z.enum(['ALIVE', 'DECEASED']).optional(),
  fatherContactNumber: z.string().optional(),
  guardianContact: z.string().optional(),
  cnic: z.string().optional(),
  dateOfBirth: z.string(),
  phone: z.string(),
  email: z.string().optional(),
  maritalStatus: z
    .enum(['MARRIED', 'UNMARRIED', 'DIVORCED', 'WIDOW'])
    .optional(),
  emergencyContactName: z.string(),
  emergencyRelation: z.string().optional(),
  emergencyContactNumber: z.string(),
  spouseName: z.string().optional(),
  spouseContactNumber: z.string().optional(),
  bloodGroup: z.string(),
  caste: z.string().optional(),
  domicile: z.string().optional(),
  province: z.string(),
  city: z.string(),
  permanentProvince: z.string().optional(),
  permanentCity: z.string().optional(),
  district: z.string().optional(),
  tehsil: z.string().optional(),
  policeStation: z.string().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  currentAddress: z.string(),
  permanentAddress: z.string().optional(),
})

type Step1Values = z.infer<typeof step1FormSchema>

const step2BaseSchema = z.object({
  currentBranchId: z.string().min(1, 'Branch is required'),
  currentDepartmentId: z.string().min(1, 'Department is required'),
  currentDesignation: z.string().min(1, 'Designation is required'),
  joiningDate: z.string().min(1, 'Joining date is required'),
  biometricId: z.string().optional(),
  shiftName: z.string().optional(),
  dutyTotalHours: z.number().int().min(1).max(24).optional(),
  dutyStartTime: z.string().optional(),
  dutyEndTime: z.string().optional(),
})

const dutyTimeRefine = (data: {
  dutyStartTime?: string
  dutyEndTime?: string
}) => {
  if (!data.dutyStartTime || !data.dutyEndTime) return true
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }
  return toMin(data.dutyStartTime) !== toMin(data.dutyEndTime)
}

const step2Schema = step2BaseSchema.refine(dutyTimeRefine, {
  message: 'Start and end time cannot be the same',
  path: ['dutyEndTime'],
})

const existingStaffStep2Schema = step2BaseSchema
  .extend({
    shiftName: z.string().min(1, 'Shift is required'),
  })
  .refine(dutyTimeRefine, {
    message: 'Start and end time cannot be the same',
    path: ['dutyEndTime'],
  })

const stipendFieldSchema = z.number().min(0)

const step3Schema = z.object({
  basicStipend: z
    .number({ error: 'Basic stipend is required' })
    .positive('Stipend must be greater than 0'),
  allowances: stipendFieldSchema,
  reward: stipendFieldSchema,
  progressReward: stipendFieldSchema,
  fuelAllowance: stipendFieldSchema,
  loanDeduction: stipendFieldSchema,
  advanceDeduction: stipendFieldSchema,
  fineDeduction: stipendFieldSchema,
  healthDeduction: stipendFieldSchema,
})

type Step2Values = z.infer<typeof step2BaseSchema>
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

function selectFieldValue(value: string | undefined) {
  const normalized = value ?? ''
  return normalized === '' ? undefined : normalized
}

class StepErrorBoundary extends Component<
  { children: ReactNode; onError: (message: string) => void },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError(error.message || 'Something went wrong rendering this step')
    console.error('Step error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

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
    'fatherStatus',
    'fatherContactNumber',
    'guardianContact',
    'phone',
    'email',
    'dateOfBirth',
    'maritalStatus',
    'emergencyContactName',
    'emergencyRelation',
    'emergencyContactNumber',
    'spouseName',
    'spouseContactNumber',
    'bloodGroup',
    'caste',
    'domicile',
    'province',
    'city',
    'permanentProvince',
    'permanentCity',
    'district',
    'tehsil',
    'policeStation',
    'currentAddress',
    'permanentAddress',
  ] as const

  const payload: Record<string, unknown> = {
    fullName: data.fullName.trim(),
    fatherName: data.fatherName,
    gender: data.gender,
  }

  if (data.cnic) payload.cnic = data.cnic

  for (const key of optionalKeys) {
    const val = data[key]
    if (val) payload[key] = val
  }

  return payload
}

function setFormErrors(
  form: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setError: (name: any, error: { message: string }) => void
    clearErrors: () => void
  },
  error: z.ZodError,
) {
  form.clearErrors()
  error.issues.forEach((issue) => {
    const path = issue.path[0]
    if (typeof path === 'string') {
      form.setError(path, { message: issue.message })
    }
  })
}

export function EmployeeCreatePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const prefill = (location.state as { prefill?: EmployeePrefill } | null)
    ?.prefill

  const [step, setStep] = useState(0)
  const [staffType, setStaffType] = useState<StaffType | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [stepError, setStepError] = useState<string | null>(null)
  const [step1Data, setStep1Data] = useState<Step1Values | null>(null)
  const [step2Data, setStep2Data] = useState<Step2Values | null>(null)
  const [step3Data, setStep3Data] = useState<Step3Values | null>(null)
  const [cnicFront, setCnicFront] = useState<File | null>(null)
  const [cnicBack, setCnicBack] = useState<File | null>(null)
  const [educationalCerts, setEducationalCerts] = useState<File[]>([])
  const [medicalCerts, setMedicalCerts] = useState<File[]>([])
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [docErrors, setDocErrors] = useState<string | null>(null)
  const [qualifications, setQualifications] = useState<QualRow[]>([])
  const [previousEmployments, setPreviousEmployments] = useState<PrevEmpRow[]>(
    [],
  )

  const form1 = useForm<Step1Values>({
    defaultValues: {
      fullName: '',
      fatherName: '',
      fatherStatus: undefined,
      fatherContactNumber: '',
      guardianContact: '',
      cnic: '',
      dateOfBirth: '',
      phone: '',
      email: '',
      maritalStatus: undefined,
      emergencyContactName: '',
      emergencyRelation: '',
      emergencyContactNumber: '',
      spouseName: '',
      spouseContactNumber: '',
      bloodGroup: '',
      caste: '',
      domicile: '',
      province: '',
      city: '',
      permanentProvince: '',
      permanentCity: '',
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
      dutyTotalHours: undefined,
      dutyStartTime: '',
      dutyEndTime: '',
      shiftName: '',
    },
  })

  const form3 = useForm<Step3Values>({
    resolver: zodResolver(step3Schema),
    defaultValues: { ...DEFAULT_STIPEND_VALUES },
  })

  const step3Watch = form3.watch

  const branchId = form2.watch('currentBranchId')
  const departmentId = form2.watch('currentDepartmentId')
  const shiftName = form2.watch('shiftName')
  const selectedGender = form1.watch('gender')
  const selectedFatherStatus = form1.watch('fatherStatus')
  const selectedMaritalStatus = form1.watch('maritalStatus')
  const selectedProvince = form1.watch('province')
  const selectedPermanentProvince = form1.watch('permanentProvince')
  const selectedDistrict = form1.watch('district')

  useEffect(() => {
    if (!shiftName) return
    const options = getStartTimeOptionsForShift(shiftName)
    if (options.length > 0) {
      form2.setValue('dutyStartTime', options[0].value)
    }
    if (shiftName === '24 Hours') {
      form2.setValue('dutyTotalHours', 24)
      form2.setValue('dutyEndTime', '23:59')
    }
  }, [shiftName, form2])

  const maritalOptions = useMemo(() => {
    if (selectedGender === 'MALE') {
      return MARITAL_STATUS_LABELS.filter((l) => l !== 'Widow')
    }
    return MARITAL_STATUS_LABELS
  }, [selectedGender])

  const isExistingStaff = staffType === 'EXISTING'

  useEffect(() => {
    if (step >= 1 && !staffType) {
      setStep(0)
    }
  }, [step, staffType])

  useEffect(() => {
    if (prefill) {
      form1.reset({
        fullName: prefill.fullName ?? '',
        fatherName: '',
        fatherStatus: undefined,
        fatherContactNumber: '',
        guardianContact: '',
        cnic: prefill.cnic ?? '',
        phone: prefill.phone ?? '',
        email: prefill.email ?? '',
        dateOfBirth: '',
        maritalStatus: undefined,
        emergencyContactName: '',
        emergencyRelation: '',
        emergencyContactNumber: '',
        spouseName: '',
        spouseContactNumber: '',
        bloodGroup: '',
        caste: '',
        domicile: '',
        province: '',
        city: '',
        permanentProvince: '',
        permanentCity: '',
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
        dutyTotalHours: undefined,
        dutyStartTime: '',
        dutyEndTime: '',
        shiftName: '',
      })
    }
  }, [prefill, form1, form2])

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getAll(),
  })

  const { data: branches = [] } = useQuery({
    queryKey: ['branches', selectedProjectId || 'all'],
    queryFn: () =>
      branchesApi.getAll(
        selectedProjectId ? { projectId: selectedProjectId } : undefined,
      ),
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', branchId],
    queryFn: () => departmentsApi.getAll({ branchId }),
    enabled: !!branchId,
  })

  const designationCategories = useMemo(() => {
    if (!departmentId) return undefined
    const dept = departments.find((d) => d.id === departmentId)
    if (!dept) return undefined
    return getDesignationCategoriesForDepartment(dept.name)
  }, [departmentId, departments])

  const designationParams = useMemo(() => {
    if (!departmentId) return undefined
    if (!designationCategories?.length) return {}
    return { categories: designationCategories.join(',') }
  }, [departmentId, designationCategories])

  const { data: designations = [] } = useQuery({
    queryKey: ['designations', designationParams],
    queryFn: () => designationsApi.getAll(designationParams),
    enabled: !!departmentId,
  })

  const designationOptions = useMemo(() => {
    const titles = [
      ...new Set(designations.map((d: { title: string }) => d.title)),
    ].sort()
    const current = form2.watch('currentDesignation')
    if (current && !titles.includes(current)) {
      return [...titles, current].sort()
    }
    return titles
  }, [designations, form2])

  const departmentOptions = useMemo(
    () => departments.map((d) => d.name),
    [departments],
  )

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
        dutyStartTime: step2Data.dutyStartTime || undefined,
        dutyEndTime: step2Data.dutyEndTime || undefined,
        dutyTotalHours: step2Data.dutyTotalHours || undefined,
        shiftName: step2Data.shiftName || undefined,
      })

      if (photoFile) {
        const formData = new FormData()
        formData.append('photo', photoFile)
        await employeesApi.uploadPhoto(employee.id, formData)
      }

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

  const onStep1Next = (e: FormEvent) => {
    e.preventDefault()
    if (!staffType) {
      setStep(0)
      return
    }
    const schema =
      staffType === 'EXISTING' ? existingStaffStep1Schema : newStaffStep1Schema
    const values = form1.getValues()
    const parsed = schema.safeParse(values)
    if (!parsed.success) {
      setFormErrors(form1, parsed.error)
      return
    }
    setStepError(null)
    setStep1Data(parsed.data as Step1Values)
    setStep(2)
  }

  const onStep2Next = (e: FormEvent) => {
    e.preventDefault()
    const schema =
      staffType === 'EXISTING' ? existingStaffStep2Schema : step2Schema
    const values = form2.getValues()
    const parsed = schema.safeParse(values)
    if (!parsed.success) {
      setFormErrors(form2, parsed.error)
      return
    }
    setStepError(null)
    setStep2Data(parsed.data)
    setStep(3)
  }

  const onStep3Next = form3.handleSubmit((data) => {
    try {
      if (!isExistingStaff && (!cnicFront || !cnicBack)) {
        setDocErrors('CNIC front and back are both required')
        return
      }
      setDocErrors(null)
      setStepError(null)
      setStep3Data(data)
      setStep(4)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to proceed to qualifications and experience'
      setStepError(message)
      console.error('Step error:', error)
    }
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

      {stepError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-red-600">{stepError}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => setStepError(null)}
          >
            Try again
          </Button>
        </div>
      )}

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
                onClick={() => {
                  setStepError(null)
                  setStep(1)
                }}
              >
                Continue
              </Button>
            </div>
          )}
        </div>
      )}

      {step >= 1 && <StepIndicator step={step} />}

      {step === 1 && staffType && (
        <StepErrorBoundary key="step-1" onError={setStepError}>
        <Form {...form1}>
          <form onSubmit={onStep1Next} className="space-y-6">
            <h2 className="text-lg font-semibold">Personal Information</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form1.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Full Name *</FormLabel>
                    <FormControl>
                      <TextOnlyInput {...field} value={field.value ?? ''} />
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
                      <CnicInput value={field.value ?? ''} onChange={field.onChange} />
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
                    <FormLabel>Date of Birth *</FormLabel>
                    <FormControl>
                      <DateInput
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
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
                    <FormLabel>Phone *</FormLabel>
                    <FormControl>
                      <PhoneInput
                        value={field.value ?? ''}
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
                name="fatherName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Father Name *</FormLabel>
                    <FormControl>
                      <TextOnlyInput {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {isExistingStaff && (
                <FormField
                  control={form1.control}
                  name="fatherStatus"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Father Status *</FormLabel>
                      <FormControl>
                        <SearchableSelect
                          options={[...FATHER_STATUS_LABELS]}
                          value={
                            field.value
                              ? fatherStatusToLabel(field.value)
                              : ''
                          }
                          onChange={(label) =>
                            field.onChange(labelToFatherStatus(label))
                          }
                          placeholder="Select father status"
                          error={form1.formState.errors.fatherStatus?.message}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {(isExistingStaff
                ? selectedFatherStatus === 'ALIVE'
                : true) && (
                <FormField
                  control={form1.control}
                  name="fatherContactNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Father Contact Number
                        {(isExistingStaff
                          ? selectedFatherStatus === 'ALIVE'
                          : true) && ' *'}
                      </FormLabel>
                      <FormControl>
                        <PhoneInput
                          value={field.value ?? ''}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {isExistingStaff && selectedFatherStatus === 'DECEASED' && (
                <FormField
                  control={form1.control}
                  name="guardianContact"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Guardian Contact *</FormLabel>
                      <FormControl>
                        <PhoneInput
                          value={field.value ?? ''}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form1.control}
                name="emergencyContactName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Emergency Contact Name *</FormLabel>
                    <FormControl>
                      <TextOnlyInput {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {isExistingStaff && (
                <FormField
                  control={form1.control}
                  name="emergencyRelation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Emergency Relation *</FormLabel>
                      <FormControl>
                        <TextOnlyInput {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form1.control}
                name="emergencyContactNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Emergency Contact Number *</FormLabel>
                    <FormControl>
                      <PhoneInput
                        value={field.value ?? ''}
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
                    <FormLabel>Blood Group *</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        options={[...BLOOD_GROUPS]}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        placeholder="Select blood group"
                        error={form1.formState.errors.bloodGroup?.message}
                      />
                    </FormControl>
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
                      <TextOnlyInput {...field} value={field.value ?? ''} />
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
                    <FormControl>
                      <SearchableSelect
                        options={GENDER_OPTIONS}
                        value={genderToLabel(field.value)}
                        onChange={(label) => field.onChange(labelToGender(label))}
                        placeholder="Select gender"
                        error={form1.formState.errors.gender?.message}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form1.control}
                name="maritalStatus"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Marital Status{isExistingStaff ? ' *' : ''}
                    </FormLabel>
                    <FormControl>
                      <SearchableSelect
                        options={[...maritalOptions]}
                        value={
                          field.value ? maritalStatusToLabel(field.value) : ''
                        }
                        onChange={(label) =>
                          field.onChange(labelToMaritalStatus(label))
                        }
                        placeholder="Select marital status"
                        error={form1.formState.errors.maritalStatus?.message}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {selectedMaritalStatus === 'MARRIED' && (
                <>
                  <FormField
                    control={form1.control}
                    name="spouseName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Spouse Name{isExistingStaff ? ' *' : ''}
                        </FormLabel>
                        <FormControl>
                          <TextOnlyInput {...field} value={field.value ?? ''} />
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
                        <FormLabel>
                          Spouse Contact Number{isExistingStaff ? ' *' : ''}
                        </FormLabel>
                        <FormControl>
                          <PhoneInput
                            value={field.value ?? ''}
                            onChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
              <EmployeeLocationFields
                control={form1.control as unknown as Control<FieldValues>}
                setValue={form1.setValue as unknown as UseFormSetValue<FieldValues>}
                province={selectedProvince ?? ''}
                district={selectedDistrict ?? ''}
                permanentProvince={selectedPermanentProvince ?? ''}
                relaxedOptionalFields={isExistingStaff}
              />
            </div>
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
        </StepErrorBoundary>
      )}

      {step === 2 && staffType && (
        <StepErrorBoundary key="step-2" onError={setStepError}>
        <Form {...form2}>
          <form onSubmit={onStep2Next} className="space-y-6">
            <h2 className="text-lg font-semibold">Job Information</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Project</Label>
                <Select
                  value={selectedProjectId || 'all'}
                  onValueChange={(value) => {
                    const nextProjectId = value === 'all' ? '' : value
                    setSelectedProjectId(nextProjectId)
                    form2.setValue('currentBranchId', '')
                    form2.setValue('currentDepartmentId', '')
                    form2.setValue('currentDesignation', '')
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Projects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Projects</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <FormField
                control={form2.control}
                name="currentBranchId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Branch *</FormLabel>
                    <Select
                      value={selectFieldValue(field.value)}
                      onValueChange={(v) => {
                        field.onChange(v)
                        form2.setValue('currentDepartmentId', '')
                        form2.setValue('currentDesignation', '')
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
                            {formatBranchLabel(b)}
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
                    <FormControl>
                      <SearchableSelect
                        options={departmentOptions}
                        value={
                          departments.find((d) => d.id === field.value)?.name ??
                          ''
                        }
                        onChange={(name) => {
                          const dept = findDepartmentByName(departments, name)
                          if (dept) {
                            field.onChange(dept.id)
                            form2.setValue('currentDesignation', '')
                          }
                        }}
                        placeholder="Select department"
                        disabled={!branchId}
                        error={form2.formState.errors.currentDepartmentId?.message}
                      />
                    </FormControl>
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
                      <SearchableSelect
                        label="Designation *"
                        options={designationOptions}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        placeholder="Select designation"
                        disabled={!departmentId}
                        error={form2.formState.errors.currentDesignation?.message}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form2.control}
                name="shiftName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Shift{isExistingStaff ? ' *' : ''}</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        options={[...SHIFT_OPTIONS]}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        placeholder={
                          isExistingStaff
                            ? 'Select shift'
                            : 'Select shift (optional)'
                        }
                        error={form2.formState.errors.shiftName?.message}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DutyHoursFields
                shiftName={shiftName ?? ''}
                totalHours={form2.watch('dutyTotalHours') ?? ''}
                startTime={form2.watch('dutyStartTime') ?? ''}
                endTime={form2.watch('dutyEndTime') ?? ''}
                onTotalHoursChange={(value) =>
                  form2.setValue(
                    'dutyTotalHours',
                    value === '' ? undefined : value,
                  )
                }
                onStartTimeChange={(value) =>
                  form2.setValue('dutyStartTime', value)
                }
                onEndTimeChange={(value) =>
                  form2.setValue('dutyEndTime', value)
                }
              />
              <FormField
                control={form2.control}
                name="joiningDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Joining Date *</FormLabel>
                    <FormControl>
                      <DateInput
                        min="1990-01-01"
                        max="2099-12-31"
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
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
        </StepErrorBoundary>
      )}

      {step === 3 && staffType && (
        <StepErrorBoundary key="step-3" onError={setStepError}>
        <Form {...form3}>
          <form onSubmit={onStep3Next} className="space-y-6">
            <h2 className="text-lg font-semibold">Stipend & Documents</h2>

            <StipendPackageFields
              control={form3.control}
              watch={step3Watch}
            />

            <div className="space-y-6">
              <div>
                <p className="text-sm font-medium">
                  CNIC Documents
                  {!isExistingStaff && (
                    <span className="text-destructive"> *</span>
                  )}
                </p>
                <p className="text-xs text-text-secondary">
                  {isExistingStaff
                    ? 'Optional — upload front and back separately'
                    : 'Upload front and back separately'}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FileDropZone
                  label={isExistingStaff ? 'CNIC Front' : 'CNIC Front *'}
                  file={cnicFront}
                  onChange={setCnicFront}
                />
                <FileDropZone
                  label={isExistingStaff ? 'CNIC Back' : 'CNIC Back *'}
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

              <FileDropZone
                label="Employee Photo"
                file={photoFile}
                onChange={setPhotoFile}
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
        </StepErrorBoundary>
      )}

      {step === 4 && staffType && (
        <StepErrorBoundary key="step-4" onError={setStepError}>
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
        </StepErrorBoundary>
      )}
    </div>
  )
}
