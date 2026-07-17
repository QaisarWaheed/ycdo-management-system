import { useEffect, useMemo } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import type { Control, FieldValues, UseFormSetValue } from 'react-hook-form'
import { z } from 'zod'
import { designationsApi } from '@/api/endpoints/designations'
import { employeesApi } from '@/api/endpoints/employees'
import { CnicInput, isValidCnic } from '@/components/common/CnicInput'
import { DateInput } from '@/components/common/DateInput'
import { SearchableSelect } from '@/components/common/SearchableSelect'
import { PhoneInput } from '@/components/common/PhoneInput'
import { TextOnlyInput } from '@/components/common/TextOnlyInput'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { toast } from '@/hooks/use-toast'
import { EmployeeLocationFields } from '@/components/employees/EmployeeLocationFields'
import {
  BLOOD_GROUP_OPTIONS,
  GENDER_OPTIONS,
  genderToLabel,
  labelToGender,
} from '@/lib/searchableSelectOptions'
import type { Employee } from '@/types'

const BLOOD_GROUPS = BLOOD_GROUP_OPTIONS

const phoneOptional = z
  .string()
  .optional()
  .refine((v) => !v || /^0\d{10}$/.test(v), 'Must be 11 digits starting with 0')

const editSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  fatherName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  phone: phoneOptional,
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  bloodGroup: z.string().optional(),
  caste: z.string().optional(),
  domicile: z.string().optional(),
  province: z.string().optional(),
  city: z.string().optional(),
  permanentProvince: z.string().optional(),
  permanentCity: z.string().optional(),
  district: z.string().optional(),
  tehsil: z.string().optional(),
  policeStation: z.string().optional(),
  currentAddress: z.string().optional(),
  permanentAddress: z.string().optional(),
  fatherContactNumber: phoneOptional,
  emergencyContactName: z.string().optional(),
  emergencyContactNumber: phoneOptional,
  spouseName: z.string().optional(),
  spouseContactNumber: phoneOptional,
  cnic: z
    .string()
    .optional()
    .refine((v) => !v || isValidCnic(v), 'CNIC format: 12345-1234567-1'),
  joiningDate: z.string().optional(),
  currentDesignation: z.string().optional(),
})

type EditFormValues = z.infer<typeof editSchema>

function toDateInput(value?: string | null) {
  if (!value) return ''
  return value.slice(0, 10)
}

function buildPayload(
  data: EditFormValues,
  mode: 'personal' | 'job',
): Record<string, unknown> {
  if (mode === 'job') {
    const payload: Record<string, unknown> = {}
    if (data.joiningDate) payload.joiningDate = data.joiningDate
    if (data.currentDesignation) payload.currentDesignation = data.currentDesignation
    if (data.cnic) payload.cnic = data.cnic
    return payload
  }

  const payload: Record<string, unknown> = {
    fullName: data.fullName.trim(),
    gender: data.gender,
  }

  const personalKeys = [
    'fatherName',
    'dateOfBirth',
    'phone',
    'email',
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
    'fatherContactNumber',
    'emergencyContactName',
    'emergencyContactNumber',
    'spouseName',
    'spouseContactNumber',
  ] as const

  for (const key of personalKeys) {
    const val = data[key]
    if (val) payload[key] = val
  }

  if (data.cnic) payload.cnic = data.cnic

  return payload
}

function employeeToFormValues(employee: Employee): EditFormValues {
  return {
    fullName: employee.fullName ?? '',
    fatherName: employee.fatherName ?? '',
    dateOfBirth: toDateInput(employee.dateOfBirth),
    phone: employee.phone ?? '',
    email: employee.email ?? '',
    gender: employee.gender,
    bloodGroup: employee.bloodGroup ?? '',
    caste: employee.caste ?? '',
    domicile: employee.domicile ?? '',
    province: employee.province ?? '',
    city: employee.city ?? '',
    permanentProvince: employee.permanentProvince ?? '',
    permanentCity: employee.permanentCity ?? '',
    district: employee.district ?? '',
    tehsil: employee.tehsil ?? '',
    policeStation: employee.policeStation ?? '',
    currentAddress: employee.currentAddress ?? '',
    permanentAddress: employee.permanentAddress ?? '',
    fatherContactNumber: employee.fatherContactNumber ?? '',
    emergencyContactName: employee.emergencyContactName ?? '',
    emergencyContactNumber: employee.emergencyContactNumber ?? '',
    spouseName: employee.spouseName ?? '',
    spouseContactNumber: employee.spouseContactNumber ?? '',
    cnic: employee.cnic ?? '',
    joiningDate: toDateInput(employee.joiningDate),
    currentDesignation: employee.currentDesignation ?? '',
  }
}

export function EditEmployeeDialog({
  employee,
  open,
  onOpenChange,
  onSuccess,
  mode = 'personal',
  canEditCnic = false,
}: {
  employee: Employee
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  mode?: 'personal' | 'job'
  canEditCnic?: boolean
}) {
  const form = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: employeeToFormValues(employee),
  })

  const watchedDesignation = form.watch('currentDesignation')

  const selectedProvince = form.watch('province')
  const selectedPermanentProvince = form.watch('permanentProvince')
  const selectedDistrict = form.watch('district')

  const designationParams = useMemo(() => {
    if (!employee.currentDepartment?.name) return {}
    return { department: employee.currentDepartment.name }
  }, [employee.currentDepartment?.name])

  const { data: designations = [] } = useQuery({
    queryKey: ['designations', designationParams],
    queryFn: () => designationsApi.getAll(designationParams),
    enabled: open,
  })

  const designationOptions = useMemo(() => {
    const titles = [
      ...new Set(designations.map((d: { title: string }) => d.title)),
    ].sort()
    if (
      employee.currentDesignation &&
      !titles.includes(employee.currentDesignation)
    ) {
      return [...titles, employee.currentDesignation].sort()
    }
    return titles
  }, [designations, employee.currentDesignation])

  useEffect(() => {
    if (open) {
      form.reset(employeeToFormValues(employee))
    }
  }, [open, employee, form])

  const mutation = useMutation({
    mutationFn: (data: EditFormValues) =>
      employeesApi.update(employee.id, buildPayload(data, mode)),
    onSuccess: () => {
      toast({
        title:
          mode === 'job'
            ? 'Job information updated'
            : 'Personal information updated',
      })
      onSuccess()
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Update failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'job' ? 'Edit Job Information' : 'Edit Personal Information'}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
            className="space-y-6"
          >
            {mode === 'personal' && (
            <>
            <div className="space-y-3">
              <p className="text-sm font-semibold text-text-secondary">
                Basic Information
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Full Name *</FormLabel>
                      <FormControl>
                        <TextOnlyInput {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
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
                {canEditCnic ? (
                  <FormField
                    control={form.control}
                    name="cnic"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>CNIC</FormLabel>
                        <FormControl>
                          <CnicInput
                            value={field.value ?? ''}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            name={field.name}
                            ref={field.ref}
                            error={!!form.formState.errors.cnic}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <div className="space-y-2">
                    <Label>CNIC</Label>
                    <Input value={employee.cnic ?? ''} disabled />
                  </div>
                )}
                <FormField
                  control={form.control}
                  name="gender"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Gender *</FormLabel>
                      <FormControl>
                        <SearchableSelect
                          options={GENDER_OPTIONS}
                          value={genderToLabel(field.value)}
                          onChange={(label) =>
                            field.onChange(labelToGender(label))
                          }
                          placeholder="Select gender"
                          error={form.formState.errors.gender?.message}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dateOfBirth"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date of Birth</FormLabel>
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
                  control={form.control}
                  name="bloodGroup"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Blood Group</FormLabel>
                      <FormControl>
                        <SearchableSelect
                          options={[...BLOOD_GROUPS]}
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          placeholder="Select blood group"
                          error={form.formState.errors.bloodGroup?.message}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
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
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-semibold text-text-secondary">Contact</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <PhoneInput {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
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
                  control={form.control}
                  name="fatherContactNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Father Contact</FormLabel>
                      <FormControl>
                        <PhoneInput {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
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
                  control={form.control}
                  name="emergencyContactNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Emergency Contact Number</FormLabel>
                      <FormControl>
                        <PhoneInput {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
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
                  control={form.control}
                  name="spouseContactNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Spouse Contact</FormLabel>
                      <FormControl>
                        <PhoneInput {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-semibold text-text-secondary">
                Address & Location
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <EmployeeLocationFields
                  control={form.control as unknown as Control<FieldValues>}
                  setValue={form.setValue as unknown as UseFormSetValue<FieldValues>}
                  province={selectedProvince ?? ''}
                  district={selectedDistrict ?? ''}
                  permanentProvince={selectedPermanentProvince ?? ''}
                />
              </div>
            </div>
            </>
            )}

            {mode === 'job' && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-text-secondary">
                Job Information
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="currentDesignation"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormControl>
                        <SearchableSelect
                          label="Designation"
                          options={designationOptions}
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          placeholder="Select designation"
                          error={
                            form.formState.errors.currentDesignation?.message ||
                            (employee.currentDesignation == null &&
                            !watchedDesignation
                              ? 'Designation is required'
                              : undefined)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="joiningDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Joining Date</FormLabel>
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
                <div className="space-y-2">
                  <Label>Biometric ID</Label>
                  <Input
                    value={employee.biometricId ?? 'Auto-assigned'}
                    disabled
                    readOnly
                  />
                </div>
                {canEditCnic && (
                  <FormField
                    control={form.control}
                    name="cnic"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>CNIC</FormLabel>
                        <FormControl>
                          <CnicInput
                            value={field.value ?? ''}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            name={field.name}
                            ref={field.ref}
                            error={!!form.formState.errors.cnic}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
              <p className="text-sm text-amber-700">
                To change branch, department, or duty hours, use Edit Branch &
                Duty.
              </p>
            </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-primary hover:bg-primary-dark"
                disabled={mutation.isPending}
              >
                {mutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
