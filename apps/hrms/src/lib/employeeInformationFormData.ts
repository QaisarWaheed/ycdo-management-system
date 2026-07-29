import { format } from 'date-fns'
import type { EmployeeOnboardingApproval } from '@/api/endpoints/employeeOnboarding'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import { resolveFileUrl } from '@/lib/resolveFileUrl'

export interface QualificationRow {
  degree: string
  boardUniversity: string
  marks: string
  division: string
}

export interface PreviousJobRow {
  organizationName: string
  ownerAdminName: string
  contactNumber: string
  postalAddress: string
  totalExperience: string
}

export interface EmployeeInformationFormData {
  code: string
  page: string
  photoUrl?: string | null
  fullName: string
  phone: string
  cnic: string
  fatherName: string
  fatherStatus: string
  fatherContact: string
  guardianContact: string
  emergencyContactName: string
  emergencyRelation: string
  emergencyContactNumber: string
  spouseName: string
  spouseContact: string
  dateOfBirth: string
  caste: string
  joiningDate: string
  email: string
  domicile: string
  currentAddress: string
  permanentAddress: string
  province: string
  city: string
  permanentProvince: string
  permanentCity: string
  district: string
  tehsil: string
  policeStation: string
  gender: string
  maritalStatus: string
  bloodGroup: string
  staffType: string
  dutyTimings: string
  academicQualifications: QualificationRow[]
  jobQualifications: QualificationRow[]
  previousJobs: PreviousJobRow[]
  experienceNotes: string
  postingPlace: string
  designation: string
  stipend: string
  submittedBy: string
  approverTarget?: string
}

function fmtDate(value: unknown): string {
  if (!value || typeof value !== 'string') return ''
  try {
    return format(new Date(value), 'dd/MM/yyyy')
  } catch {
    return value
  }
}

function str(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function qualRows(
  snapshot: Record<string, unknown>,
  fallback: Array<Record<string, unknown>>,
  type: 'ACADEMIC' | 'JOB_RELEVANT',
  emptyCount: number,
): QualificationRow[] {
  const snapshotList = Array.isArray(snapshot.qualifications)
    ? (snapshot.qualifications as Array<Record<string, string>>)
    : []
  const list = (
    snapshotList.length > 0 ? snapshotList : fallback
  ) as Array<Record<string, string>>
  const filtered = list
    .filter((q) => (q.qualType ?? 'ACADEMIC') === type)
    .map((q) => ({
      degree: str(q.degree),
      boardUniversity: str(q.boardUniversity),
      marks: str(q.obtainedMarks),
      division: str(q.divisionGrade),
    }))

  while (filtered.length < emptyCount) {
    filtered.push({
      degree: '',
      boardUniversity: '',
      marks: '',
      division: '',
    })
  }
  return filtered.slice(0, emptyCount)
}

export function buildEmployeeInformationFormData(
  approval: EmployeeOnboardingApproval,
): EmployeeInformationFormData {
  const snapshot = (approval.formSnapshot ?? {}) as Record<string, unknown>
  const employee = approval.employee

  const prevList = Array.isArray(snapshot.previousEmployments)
    ? (snapshot.previousEmployments as Array<Record<string, string>>)
    : employee?.previousEmployments?.map((p) => ({
        organizationName: p.organizationName,
        ownerAdminName: p.ownerAdminName ?? '',
        contactNumber: p.contactNumber ?? '',
        postalAddress: p.postalAddress ?? '',
        totalExperience: p.totalExperience ?? '',
      })) ?? []

  const previousJobs: PreviousJobRow[] = prevList.map((p) => ({
    organizationName: str(p.organizationName),
    ownerAdminName: str(p.ownerAdminName),
    contactNumber: str(p.contactNumber),
    postalAddress: str(p.postalAddress),
    totalExperience: str(p.totalExperience),
  }))
  const experienceNotes = prevList
    .map((p) => {
      const parts = [str(p.organizationName), str(p.totalExperience)].filter(Boolean)
      return parts.length ? `• ${parts.join(' — ')}` : ''
    })
    .filter(Boolean)
    .join('\n')

  const branchLabel =
    str(snapshot.branchName) ||
    formatBranchLabel(employee?.currentBranch) ||
    ''
  const deptLabel =
    str(snapshot.departmentName) || employee?.currentDepartment?.name || ''

  const dutyStart = str(snapshot.dutyStartTime)
  const dutyEnd = str(snapshot.dutyEndTime)
  const dutyHours = str(snapshot.dutyTotalHours)
  const dutyTimings = [
    dutyStart && dutyEnd ? `${dutyStart} — ${dutyEnd}` : '',
    dutyHours ? `${dutyHours} hrs` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const basicStipend =
    snapshot.basicStipend ?? employee?.stipendRecords?.[0]?.basicStipend

  return {
    code: employee?.employeeCode ?? str(snapshot.employeeCode) ?? '—',
    page: '1',
    photoUrl: employee?.photoUrl
      ? resolveFileUrl(employee.photoUrl)
      : null,
    fullName: str(snapshot.fullName) || employee?.fullName || '',
    phone: str(snapshot.phone),
    cnic: str(snapshot.cnic),
    fatherName: str(snapshot.fatherName),
    fatherStatus: str(snapshot.fatherStatus),
    fatherContact: str(snapshot.fatherContactNumber),
    guardianContact: str(snapshot.guardianContact),
    emergencyContactName: str(snapshot.emergencyContactName),
    emergencyRelation: str(snapshot.emergencyRelation),
    emergencyContactNumber: str(snapshot.emergencyContactNumber),
    spouseName: str(snapshot.spouseName),
    spouseContact: str(snapshot.spouseContactNumber),
    dateOfBirth: fmtDate(snapshot.dateOfBirth),
    caste: str(snapshot.caste),
    joiningDate: fmtDate(snapshot.joiningDate ?? employee?.joiningDate),
    email: str(snapshot.email),
    domicile: str(snapshot.domicile),
    currentAddress: str(snapshot.currentAddress),
    permanentAddress: str(snapshot.permanentAddress),
    province: str(snapshot.province),
    city: str(snapshot.city),
    permanentProvince: str(snapshot.permanentProvince),
    permanentCity: str(snapshot.permanentCity),
    district: str(snapshot.district),
    tehsil: str(snapshot.tehsil),
    policeStation: str(snapshot.policeStation),
    gender: str(snapshot.gender),
    maritalStatus: str(snapshot.maritalStatus),
    bloodGroup: str(snapshot.bloodGroup),
    staffType: str(snapshot.staffType),
    dutyTimings,
    academicQualifications: qualRows(
      snapshot,
      employee?.academicQualifications ?? [],
      'ACADEMIC',
      4,
    ),
    jobQualifications: qualRows(
      snapshot,
      employee?.academicQualifications ?? [],
      'JOB_RELEVANT',
      3,
    ),
    previousJobs,
    experienceNotes,
    postingPlace: [branchLabel, deptLabel].filter(Boolean).join(' · '),
    designation:
      str(snapshot.currentDesignation) || employee?.currentDesignation || '',
    stipend: basicStipend != null ? `PKR ${basicStipend}` : '',
    submittedBy:
      approval.submittedBy?.employee?.fullName ??
      approval.submittedBy?.email ??
      'HR',
    approverTarget: approval.approverTarget,
  }
}

export function buildFormDataFromDraft(input: {
  step1: Record<string, unknown>
  step2: Record<string, unknown>
  step3: Record<string, unknown>
  staffType: string
  branchName?: string
  departmentName?: string
  qualifications: Array<{
    degree: string
    boardUniversity: string
    obtainedMarks: string
    divisionGrade: string
    qualType: string
  }>
  previousEmployments: Array<{
    organizationName: string
    ownerAdminName: string
    contactNumber: string
    postalAddress: string
    totalExperience: string
  }>
  photoPreviewUrl?: string | null
  approverTarget?: string
}): EmployeeInformationFormData {
  const snapshot = {
    ...input.step1,
    ...input.step2,
    ...input.step3,
    staffType: input.staffType,
    branchName: input.branchName,
    departmentName: input.departmentName,
    qualifications: input.qualifications,
    previousEmployments: input.previousEmployments,
  }

  return buildEmployeeInformationFormData({
    id: 'draft',
    employeeId: '',
    submittedById: '',
    approverTarget: (input.approverTarget as EmployeeOnboardingApproval['approverTarget']) ?? 'PRESIDENT',
    status: 'PENDING',
    formSnapshot: snapshot,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    employee: {
      id: '',
      fullName: str(input.step1.fullName),
      employeeCode: 'DRAFT',
      joiningDate: str(input.step2.joiningDate),
      currentDesignation: str(input.step2.currentDesignation),
      photoUrl: input.photoPreviewUrl ?? null,
      currentBranch: input.branchName
        ? { name: input.branchName, abbreviation: null }
        : undefined,
      currentDepartment: input.departmentName
        ? { name: input.departmentName }
        : undefined,
    },
  })
}
