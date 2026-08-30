import type { PayslipSlipData } from '@/lib/payslipSlip'

export interface User {
  id: string
  email: string
  role: string
  /** All effective roles including primary + additional */
  roles?: string[]
  employeeId?: string | null
  branchId?: string | null
  /** Effective permission keys granted via role defaults + Login Access overrides */
  permissions?: string[]
}

export interface AuthLoginResponse {
  access_token: string
  user: User
}

export interface AuthOtpChallengeResponse {
  requiresOtp: true
  challengeId: string
  message: string
  expiresInSeconds: number
}

export type AuthLoginResult = AuthLoginResponse | AuthOtpChallengeResponse

export function isAuthOtpChallenge(
  result: AuthLoginResult,
): result is AuthOtpChallengeResponse {
  return 'requiresOtp' in result && result.requiresOtp === true
}

export type EmployeeStatus =
  | 'ACTIVE'
  | 'PENDING_APPROVAL'
  | 'TRAINEE'
  | 'APPOINTED'
  | 'SUSPENDED'
  | 'TERMINATED'
  | 'RESIGNED'
  | 'ON_LEAVE'
  | 'ON_REST'
  | 'DISMISSED'

export type Gender = 'MALE' | 'FEMALE' | 'OTHER'
export type StaffType = 'NEW' | 'EXISTING' | 'INTERNEE'

export const GENDERS: Gender[] = ['MALE', 'FEMALE', 'OTHER']

export interface Branch {
  id: string
  name: string
  abbreviation?: string | null
  address?: string | null
  phone?: string | null
  projectId?: string | null
  project?: { id: string; name: string; type?: string } | null
  isActive?: boolean
  _count?: {
    employees?: number
    departments?: number
    shifts?: number
  }
}

export interface BranchDetail extends Branch {
  departments?: {
    id: string
    name: string
    _count?: { employees: number }
  }[]
  shifts?: ShiftInBranch[]
}

export interface ShiftInBranch {
  id: string
  name: string
  startTime: string
  endTime: string
  _count?: { employees: number }
}

export type ProjectType =
  | 'HOSPITAL'
  | 'VTI'
  | 'KITCHEN'
  | 'SOFTWARE_HOUSE'

export interface ProjectBranch {
  id: string
  name: string
  address?: string | null
  sortOrder?: number | null
  employeeCount?: number
  _count?: { employees: number; departments?: number; shifts?: number }
}

export interface Project {
  id: string
  name: string
  type: ProjectType
  isActive?: boolean
  _count?: { branches: number }
  branches?: ProjectBranch[]
}

export interface Shift {
  id: string
  branchId?: string | null
  name: string
  startTime: string
  endTime: string
  isActive?: boolean
  branch?: { name: string; address?: string | null; abbreviation?: string | null } | null
  _count?: { employees: number }
}

export type AllowanceType =
  | 'OVERTIME'
  | 'RELIEVER'
  | 'CUSTOM'
  | 'ADDITIONAL_WORKING_DAYS'

export interface PayrollAllowance {
  id: string
  type: AllowanceType
  description?: string | null
  amount: number | string
  hours?: number | string | null
}

export interface RelieverSessionsSummary {
  sessions: RelieverSession[]
  totalMinutes: number
  totalHours: number
}

export interface RelieverSession {
  id: string | null
  employeeId: string
  checkIn?: string | null
  checkOut?: string | null
  totalMinutes: number
  date: string
  employee?: {
    id?: string
    fullName: string
    employeeCode: string
  }
  branch?: { name: string; address?: string | null; abbreviation?: string | null }
  coveringEmployee?: {
    id: string
    fullName: string
    employeeCode: string
  } | null
  leaveRecordId?: string | null
  relieverRequestId?: string | null
  relieverRequestStatus?: string | null
  sessionStatus?: 'NOT_STARTED' | 'ACTIVE' | 'COMPLETED'
}

export type BroadcastTarget =
  | 'ALL'
  | 'SUPER_ADMIN'
  | 'HR_MANAGER'
  | 'BRANCH_HR'
  | 'DEPARTMENT_HEAD'
  | 'PAYROLL_OFFICER'
  | 'EMPLOYEE'

export interface NotificationBroadcast {
  id: string
  title: string
  message: string
  targetRole: BroadcastTarget
  isActive: boolean
  createdAt: string
  createdBy?: { email: string }
}

export interface LetterReply {
  id: string
  letterId: string
  replyText: string
  repliedAt: string
  employee?: {
    fullName: string
    employeeCode: string
  }
}

export const BROADCAST_TARGETS: { value: BroadcastTarget; label: string }[] = [
  { value: 'ALL', label: 'All Employees' },
  { value: 'SUPER_ADMIN', label: 'Super Admin only' },
  { value: 'HR_MANAGER', label: 'HR Managers' },
  { value: 'BRANCH_HR', label: 'Branch HR' },
  { value: 'DEPARTMENT_HEAD', label: 'Department Heads' },
  { value: 'PAYROLL_OFFICER', label: 'Payroll Officers' },
  { value: 'EMPLOYEE', label: 'Employees only' },
]

export const ALLOWANCE_TYPES: { value: AllowanceType; label: string }[] = [
  { value: 'OVERTIME', label: 'Overtime' },
  { value: 'RELIEVER', label: 'Reliever' },
  { value: 'CUSTOM', label: 'Custom' },
  { value: 'ADDITIONAL_WORKING_DAYS', label: 'Additional working days' },
]

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  HOSPITAL: 'Hospital',
  VTI: 'VTI',
  KITCHEN: 'Kitchen',
  SOFTWARE_HOUSE: 'Software House',
}

export interface Department {
  id: string
  name: string
  branchId: string
}

export interface Employee {
  id: string
  employeeCode: string
  fullName: string
  fatherName?: string | null
  fatherStatus?: 'ALIVE' | 'DECEASED' | null
  guardianContact?: string | null
  cnic?: string | null
  phone?: string | null
  email?: string | null
  dateOfBirth?: string | null
  gender: Gender
  address?: string | null
  fatherContactNumber?: string | null
  emergencyContactName?: string | null
  emergencyContactNumber?: string | null
  emergencyRelation?: string | null
  maritalStatus?: 'MARRIED' | 'UNMARRIED' | 'DIVORCED' | 'WIDOW' | null
  spouseName?: string | null
  spouseContactNumber?: string | null
  caste?: string | null
  domicile?: string | null
  currentAddress?: string | null
  permanentAddress?: string | null
  province?: string | null
  city?: string | null
  permanentProvince?: string | null
  permanentCity?: string | null
  district?: string | null
  tehsil?: string | null
  policeStation?: string | null
  bloodGroup?: string | null
  photoUrl?: string | null
  privatePhotoUrl?: string | null
  hideProfilePhoto?: boolean
  hasPrivatePhoto?: boolean
  status: EmployeeStatus
  joiningDate: string
  currentDesignation: string | null
  currentBranchId?: string
  currentDepartmentId?: string | null
  biometricId?: string | null
  biometricRegistration?: {
    biometricId: string | null
    biometricIdAssigned: boolean
    registeredDeviceCount: number
    totalDevices: number
    registrationStatus: 'NOT_REGISTERED' | 'PARTIAL' | 'REGISTERED'
    devices: Array<{
      deviceId: string
      label: string | null
      branchName: string
      registered: boolean
      lastSyncedAt: string | null
    }>
  }
  currentBranch?: Branch
  currentDepartment?: Department | null
  shift?: Shift | null
  shiftId?: string | null
  /** Reliever-only doctors/staff: no regular duty attendance. */
  relieverOnly?: boolean
  dutyStartTime?: string | null
  dutyEndTime?: string | null
  dutyTotalHours?: number | null
  /** Monthly paid leave allowance; null = unlimited. */
  monthlyAllowedLeaves?: number | null
  employmentHistory?: EmploymentHistory[]
  stipendRecords?: StipendRecord[]
  documents?: EmployeeDocument[]
  academicQualifications?: AcademicQualification[]
  previousEmployments?: PreviousEmployment[]
  user?: {
    id: string
    email?: string
    role: string
    roles?: string[]
    additionalRoles?: string[]
    managerScopes?: {
      id?: string
      projectId: string
      departmentId: string
      designationId?: string | null
      projectName?: string
      departmentName?: string
      designationTitle?: string | null
      label: string
    }[]
    isActive?: boolean
    branchId?: string | null
    branch?: { name: string; address?: string | null; abbreviation?: string | null } | null
    passwordRecord?: { plainText: string } | null
  } | null
}

export type QualType = 'ACADEMIC' | 'JOB_RELEVANT'

export interface AcademicQualification {
  id: string
  employeeId: string
  qualType: QualType
  degree: string
  boardUniversity: string
  obtainedMarks?: string | null
  divisionGrade?: string | null
  createdAt: string
}

export interface PreviousEmployment {
  id: string
  employeeId: string
  organizationName: string
  ownerAdminName?: string | null
  contactNumber?: string | null
  postalAddress?: string | null
  totalExperience?: string | null
  relevantExperience?: string | null
  jobResponsibilities?: string | null
  createdAt: string
}

export type BranchChangeRequestStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'COMPLETED'

export interface BranchChangeRequest {
  id: string
  employeeId: string
  district: string
  purpose: string
  startDate: string
  endDate: string
  duration: number
  status: BranchChangeRequestStatus
  approvedBy?: string | null
  approvedAt?: string | null
  notes?: string | null
  createdAt: string
  employee?: {
    fullName: string
    employeeCode: string
    currentBranch?: { name: string; address?: string | null; abbreviation?: string | null }
  }
}

export interface DistrictSummary {
  district: string
  total: number
  approved: number
  pending: number
  rejected: number
}

export interface AllegationAcknowledgement {
  id: string
  letterId: string
  employeeId: string
  acknowledgedAt: string
  ipAddress?: string | null
  createdAt: string
  employee?: {
    id: string
    fullName: string
    employeeCode: string
  }
  letter?: {
    id: string
    letterType: string
    content?: Record<string, unknown>
    generatedAt: string
    requiresAcknowledgement?: boolean
  }
}

export interface EmploymentHistory {
  id: string
  changeType: string
  designation: string
  effectiveDate: string
  endDate?: string | null
  branch?: { name: string; address?: string | null; abbreviation?: string | null }
  department?: { name: string }
}

export interface StipendRecord {
  id: string
  basicStipend: number | string
  allowances?: number | string | null
  reward?: number | string | null
  progressReward?: number | string | null
  fuelAllowance?: number | string | null
  loanDeduction?: number | string | null
  advanceDeduction?: number | string | null
  fineDeduction?: number | string | null
  healthDeduction?: number | string | null
  lumpsumTotal?: number | string | null
  effectiveFrom: string
  effectiveTo?: string | null
}

export interface EmployeeDocument {
  id: string
  documentType: string
  fileName: string
  fileUrl: string
  uploadedAt: string
}

export interface Letter {
  id: string
  employeeId?: string
  letterType: string
  status?: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'SENT' | 'REVERSED'
  fileUrl?: string | null
  letterNo?: string | null
  templateCode?: string | null
  variables?: Record<string, unknown> | null
  templateVersion?: number | null
  generatedAt: string
  printedAt?: string | null
  whatsappSharedAt?: string | null
  whatsappShareChannel?: string | null
  content?: Record<string, unknown>
  replyDeadline?: string | null
  isReplied?: boolean
  autoEscalated?: boolean
  requiresAcknowledgement?: boolean
  reversedAt?: string | null
  reversalReason?: string | null
  acknowledgement?: AllegationAcknowledgement | null
  employee?: {
    id?: string
    fullName: string
    employeeCode: string
    phone?: string | null
    currentDesignation?: string | null
    currentBranch?: { name?: string; abbreviation?: string } | null
  }
  suspensionRequest?: {
    id: string
    status: string
    periodStart?: string
    periodEnd?: string
    inquiryDeadlineAt?: string
    inquiryOfficer?: {
      id: string
      email?: string
      employee?: { fullName: string } | null
    } | null
  } | null
  whatsappSend?: {
    status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED'
    error?: string | null
    attempts?: number
    lastTriedAt?: string | null
  } | null
}

export interface LetterTemplate {
  id: string
  code: string
  name: string
  bodyHtml?: string
  bodyHtmlEn?: string | null
  subjectUr?: string | null
  subjectEn?: string | null
  enTitle?: string | null
  enPrescribed?: string | null
  enSubtitle?: string | null
  letterCode?: string | null
  fieldsSchema?: LetterTemplateFieldDef[] | null
  primaryLanguage: 'ur' | 'en'
  isCustom: boolean
  requiredVars: string[]
  version: number
  active: boolean
  createdAt?: string
  updatedAt?: string
}

export interface LetterTemplateFieldDef {
  key: string
  label: string
  type?: 'text' | 'textarea' | 'number' | 'date' | 'select'
  hint?: string
  onTemplate?: boolean
  required?: boolean
  options?: { value: string; label: string }[]
}

export interface LetterWhatsAppShare {
  letterId: string
  phoneE164: string | null
  phoneConfigured: boolean
  waUrl: string
  message: string
  filename: string
  employee: {
    id: string
    fullName: string
    employeeCode: string
    phone?: string | null
  }
  letterType: string
  letterNo?: string | null
}

export type LeaveStatus =
  | 'PENDING'
  | 'BRANCH_APPROVED'
  | 'DEPT_APPROVED'
  | 'RELIEVER_PENDING'
  | 'RELIEVER_CONFIRMED'
  | 'RELIEVER_REJECTED'
  | 'HR_PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'PENDING_APPROVAL'

export type LeaveApprovalStage =
  | 'BRANCH_MANAGER'
  | 'DEPARTMENT_INCHARGE'
  | 'HR_OPERATIONS'
  | 'QUOTA_EXCEPTION'

export type LeaveApprovalAction = 'APPROVED' | 'REJECTED'

export interface LeaveApproval {
  id: string
  leaveId: string
  stage: LeaveApprovalStage
  action: LeaveApprovalAction
  actionBy: string
  actionAt: string
  notes?: string | null
  actionByUser?: { id: string; email: string; role: string }
}

export type RelieverRequestStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'AUTO_REJECTED'
  | 'HR_ASSIGNED'

export interface RelieverRequest {
  id: string
  leaveRecordId: string
  requestedById: string
  relieverId: string
  status: RelieverRequestStatus
  requestedAt: string
  respondedAt?: string | null
  autoRejectedAt?: string | null
  hrAssigned: boolean
  hrAssignedBy?: string | null
  hrAssignedAt?: string | null
  notes?: string | null
  createdAt: string
  reliever?: {
    fullName: string
    employeeCode: string
  }
  requestedBy?: {
    fullName: string
    employeeCode: string
  }
}

export interface LeaveRecord {
  id: string
  employeeId?: string
  startDate: string
  endDate: string
  totalDays: number
  status: LeaveStatus
  leaveType?: string
  reason?: string | null
  approvedBy?: string | null
  currentStage?: LeaveApprovalStage | null
  branchManagerId?: string | null
  deptInchargeId?: string | null
  createdAt?: string
  relieverRequest?: RelieverRequest | null
  approvals?: LeaveApproval[]
  employee?: {
    fullName: string
    employeeCode: string
    currentBranchId?: string
    currentDepartmentId?: string
    currentBranch?: { id: string; name: string; address?: string | null }
    currentDepartment?: { name: string }
  }
}

export interface LeaveBalance {
  employeeId: string
  year: number
  totalAllowed: number
  taken: number
  remaining: number
  pending: number
}

export interface AttendanceLog {
  id: string
  employeeId?: string
  status: string
  date: string
  checkIn?: string | null
  checkOut?: string | null
  lateMinutes?: number
  overtimeMinutes?: number
  overtimePending?: boolean
  overtimeApprovedBy?: string | null
  overtimeApprovedAt?: string | null
  type?: 'REGULAR' | 'OVERTIME'
  source?: string
  note?: string | null
  dutyStartTimeSnapshot?: string | null
  dutyEndTimeSnapshot?: string | null
  employee?: {
    fullName: string
    employeeCode: string
    phone?: string | null
    currentDesignation?: string | null
    currentDepartmentId?: string | null
    currentDepartment?: { name: string } | null
    dutyStartTime?: string | null
    dutyEndTime?: string | null
    relieverOnly?: boolean
    status?: string
    shift?: { name?: string; startTime?: string; endTime?: string } | null
    user?: {
      role?: string
      roles?: string[]
      additionalRoles?: string[]
    } | null
  }
  branch?: { name: string; address?: string | null; abbreviation?: string | null }
}

export type AttendanceStatus =
  | 'PRESENT'
  | 'ABSENT'
  | 'UNMARKED'
  | 'LATE'
  | 'HALF_DAY'
  | 'ON_LEAVE'
  | 'UNINFORMED_ABSENT'
  | 'SWAP_COVERED'
  | 'SHORT_LEAVE'
  | 'HOLIDAY'

export type PayrollStatus = 'PENDING' | 'PROCESSED' | 'PAID'

export type DeductionType =
  | 'LATE_ARRIVAL'
  | 'UNINFORMED_ABSENCE'
  | 'DISCIPLINARY_FINE'
  | 'UNPAID_LEAVE'
  | 'HALF_DAY'
  | 'OTHER'

export interface PayrollDeduction {
  id: string
  reason: string
  amount: number | string
  description?: string | null
}

export interface HourlyPayrollBreakdown {
  contractualBasicStipend: number
  dailyDutyHours: number
  daysInMonth: number
  scheduledHours: number
  hourlyRate: number
  workedMinutes: number
  workedHours: number
  paidLeaveMinutes: number
  paidLeaveHours: number
  payableMinutes: number
  payableHours: number
  creditedAttendanceDays?: number
  hourlyBasicEarned: number
  payrollBasicStipend?: number
  fixedAllowances: number
  fixedPackageDeductions: number
  disciplineDeductions: number
  extraAllowances: number
  netStipend: number
}

export interface PayrollEntry {
  id: string
  month: number
  year: number
  basicStipend: number | string
  totalAllowances: number | string
  totalDeductions: number | string
  netStipend: number | string
  status: PayrollStatus
  forcedNonActive?: boolean
  deductions?: PayrollDeduction[]
  allowances?: PayrollAllowance[]
  totalRelieverHours?: number
  hourlyBreakdown?: HourlyPayrollBreakdown
  stipendRecord?: StipendRecord & {
    employee?: {
      id: string
      fullName: string
      employeeCode: string
      status?: string
      cnic?: string | null
      currentDesignation?: string | null
      dutyTotalHours?: number | null
      currentBranch?: {
        id: string
        name: string
        address?: string | null
        phone?: string | null
      }
      currentDepartment?: { id: string; name: string }
    }
  }
  slip?: PayslipSlipData
}

export interface PayrollSummaryEmployee {
  entryId: string
  employeeId: string
  fullName: string
  employeeCode: string
  basicStipend: number
  contractualBasic: number
  totalDeductions: number
  totalAllowances: number
  netStipend: number
  status: PayrollStatus
  periodDays: number
  periodStipend: number
}

export interface PayrollSummary {
  month: number
  year: number
  totalEmployees: number
  totalBasicStipend: number
  totalDeductions: number
  totalAllowances: number
  totalNetStipend: number
  byStatus: {
    PENDING: number
    PROCESSED: number
    PAID: number
  }
  fromDate?: string | null
  toDate?: string | null
  periodDays?: number
  employees?: PayrollSummaryEmployee[]
  periodTotals?: {
    periodStipend: number
  }
}

export type StipendStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'AUTO_ACCEPTED'

export interface StipendReceipt {
  id: string
  employeeId: string
  payrollEntryId: string
  month: number
  year: number
  amount: number | string
  status: StipendStatus
  acceptedAt?: string | null
  rejectedAt?: string | null
  rejectionReason?: string | null
  autoAcceptedAt?: string | null
  generatedAt: string
  deadlineAt: string
  employee?: {
    fullName: string
    employeeCode: string
    currentBranch?: { name: string; address?: string | null; abbreviation?: string | null }
  }
}

export interface Incentive {
  id: string
  employeeId: string
  amount: number | string
  reason: string
  addedBy: string
  month: number
  year: number
  createdAt: string
  employee?: {
    fullName: string
    employeeCode: string
    currentBranch?: { name: string; address?: string | null; abbreviation?: string | null }
  }
}

export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'PRESENT',
  'UNMARKED',
  'ABSENT',
  'LATE',
  'HALF_DAY',
  'ON_LEAVE',
  'UNINFORMED_ABSENT',
  'SWAP_COVERED',
  'SHORT_LEAVE',
  'HOLIDAY',
]

export const DEDUCTION_TYPES: { value: DeductionType; label: string }[] = [
  { value: 'LATE_ARRIVAL', label: 'Late Arrival' },
  { value: 'UNINFORMED_ABSENCE', label: 'Uninformed Absence' },
  { value: 'HALF_DAY', label: 'Half Day' },
  { value: 'DISCIPLINARY_FINE', label: 'Disciplinary Fine' },
  { value: 'OTHER', label: 'Other' },
]

export interface AttendanceSummary {
  totalDays: number
  present: number
  absent: number
  late: number
  halfDay: number
  shortLeave: number
  onLeave: number
  uninformedAbsent: number
  holiday: number
  swapCovered: number
  unmarked?: number
  overtimeMinutes: number
  totalLateMinutes: number
}

export interface DisciplinaryAction {
  id: string
  employeeId?: string
  type: string
  reason: string
  status: string
  issuedAt: string
  employee?: {
    id?: string
    fullName: string
    employeeCode: string
    status?: string
  }
  inquiry?: Inquiry | null
  suspensionRequest?: {
    id: string
    status: string
    letterId: string
    decisionNote?: string | null
    suspendedFromBranchId?: string | null
    selectedApprover?: {
      id: string
      email?: string
      employee?: { fullName: string } | null
    } | null
  } | null
}

export interface Inquiry {
  id: string
  disciplinaryActionId: string
  startedAt: string
  deadlineAt: string
  outcome?: string | null
  notes?: string | null
  closedAt?: string | null
  inquiryOfficerUserId?: string | null
  inquiryOfficerName?: string | null
  finding?: 'GUILTY' | 'NOT_GUILTY' | null
  findingRecordedAt?: string | null
  finalAction?: 'DISMISS' | 'TERMINATE' | 'REST' | 'FINE_AND_REINSTATE' | null
  finalDecisionStatus?: 'PENDING_APPROVAL' | 'REJECTED' | 'APPLIED' | null
  destinationBranchId?: string | null
  fineAmount?: string | number | null
  appliedFineDeductionId?: string | null
  finalDecisionNote?: string | null
  finalDecidedAt?: string | null
  finalLetters?: Array<{
    letterType: string
    inquiryLetterKind: string
    triggersEmployeeResolution: boolean
    status: 'DRAFT' | 'SENT' | 'MISSING'
    letterId: string | null
    letterNo: string | null
  }>
  durationDays?: number | null
  closeRecommendation?: string | null
  officiallyOpenedAt?: string | null
  openApprovalStatus?: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | null
  inquiryOfficer?: {
    id: string
    email?: string
    employee?: {
      fullName: string
      phone?: string | null
      currentDesignation?: string | null
    } | null
  } | null
  findingRecordedBy?: {
    id: string
    email?: string
    employee?: { fullName: string } | null
  } | null
  selectedFinalApprover?: {
    id: string
    email?: string
    employee?: { fullName: string } | null
  } | null
  finalDecidedBy?: {
    id: string
    email?: string
    employee?: { fullName: string } | null
  } | null
  destinationBranch?: {
    id: string
    name: string
    abbreviation?: string | null
  } | null
  disciplinaryAction?: DisciplinaryAction
}

export type DisciplinaryType =
  | 'WARNING'
  | 'SHOW_CAUSE'
  | 'FINE'
  | 'SUSPENSION'
  | 'TERMINATION'

export type DisciplinaryStatus =
  | 'OPEN'
  | 'UNDER_INQUIRY'
  | 'RESOLVED'
  | 'DISMISSED'

export type InquiryOutcome =
  | 'REINSTATED'
  | 'TERMINATED'
  | 'REJOINED'
  | 'DISMISSED'
  | 'REST'

export const DISCIPLINARY_TYPES: DisciplinaryType[] = [
  'WARNING',
  'SHOW_CAUSE',
  'FINE',
  'SUSPENSION',
  'TERMINATION',
]

export const DISCIPLINARY_STATUSES: DisciplinaryStatus[] = [
  'OPEN',
  'UNDER_INQUIRY',
  'RESOLVED',
  'DISMISSED',
]

export const INQUIRY_OUTCOMES: InquiryOutcome[] = [
  'REINSTATED',
  'TERMINATED',
  'REJOINED',
  'DISMISSED',
  'REST',
]

export interface JobApplication {
  id: string
  fullName: string
  email: string
  phone: string
  cnic?: string | null
  position: string
  branchId?: string | null
  status: string
  appliedAt: string
  interviewDate?: string | null
  notes?: string | null
  interviewNotes?: string | null
  selectedSalary?: number | string | null
  selectedDeptId?: string | null
  selectedBranchId?: string | null
  selectedDesignation?: string | null
}

export type ApplicationStatus =
  | 'APPLIED'
  | 'SHORTLISTED'
  | 'INTERVIEW_SCHEDULED'
  | 'SELECTED'
  | 'REJECTED'

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  'APPLIED',
  'SHORTLISTED',
  'INTERVIEW_SCHEDULED',
  'SELECTED',
  'REJECTED',
]

export interface EmployeePrefill {
  fullName?: string
  email?: string
  phone?: string
  cnic?: string
  currentDesignation?: string | null
  branchId?: string
}

export interface Notification {
  id: string
  message: string
  type: string
  isRead: boolean
  createdAt: string
}

export type LetterType =
  | 'APPOINTMENT'
  | 'WARNING'
  | 'ADVICE'
  | 'DISCIPLINARY'
  | 'EXPLANATION'
  | 'SHOW_CAUSE'
  | 'FINE'
  | 'INQUIRY'
  | 'APPRECIATION'
  | 'TRANSFER'
  | 'SUSPENSION'
  | 'TERMINATION'
  | 'REINSTATEMENT'
  | 'REJOINING'
  | 'SALARY_INCREMENT'
  | 'EXPERIENCE'
  | 'EXPLANATION_FINE'
  | 'SUSPENSION_ELIGIBILITY'
  | 'NEAR_SUSPENSION_WARNING'
  | 'CUSTOM'

export type DocumentType =
  | 'CNIC'
  | 'EDUCATIONAL_CERTIFICATE'
  | 'EXPERIENCE_LETTER'
  | 'MEDICAL_CERTIFICATE'
  | 'OTHER'

export const LETTER_TYPES: { value: LetterType; label: string }[] = [
  { value: 'APPOINTMENT', label: 'Selection / Appointment' },
  { value: 'WARNING', label: 'Warning' },
  { value: 'ADVICE', label: 'Advice' },
  { value: 'DISCIPLINARY', label: 'Disciplinary' },
  { value: 'EXPLANATION', label: 'Explanation' },
  { value: 'EXPLANATION_FINE', label: 'Explanation & Fine' },
  { value: 'SHOW_CAUSE', label: 'Show Cause' },
  { value: 'FINE', label: 'Fine' },
  { value: 'INQUIRY', label: 'Inquiry' },
  { value: 'APPRECIATION', label: 'Appreciation' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'SUSPENSION', label: 'Suspension' },
  {
    value: 'SUSPENSION_ELIGIBILITY',
    label: 'اہلیت برائے معطلی',
  },
  {
    value: 'NEAR_SUSPENSION_WARNING',
    label: 'تنبیہی نوٹس برائے ممکنہ معطلی',
  },
  { value: 'TERMINATION', label: 'Termination' },
  { value: 'REINSTATEMENT', label: 'Reinstatement' },
  { value: 'REJOINING', label: 'Rejoining' },
  { value: 'SALARY_INCREMENT', label: 'Salary Increment' },
  { value: 'EXPERIENCE', label: 'Experience' },
]

export const SYSTEM_GENERATED_LETTER_TYPES = new Set<LetterType>([
  'SUSPENSION_ELIGIBILITY',
  'NEAR_SUSPENSION_WARNING',
])

/** Types HR may pick in Generate Letter. Watchlist notices are system-only. */
export const GENERATE_LETTER_TYPES = LETTER_TYPES.filter(
  (t) => !SYSTEM_GENERATED_LETTER_TYPES.has(t.value),
)

export const EMPLOYEE_STATUSES: EmployeeStatus[] = [
  'ACTIVE',
  'PENDING_APPROVAL',
  'TRAINEE',
  'APPOINTED',
  'ON_REST',
  'SUSPENDED',
  'TERMINATED',
  'RESIGNED',
  'ON_LEAVE',
  'DISMISSED',
]

export const LEAVE_STATUSES: LeaveStatus[] = [
  'PENDING',
  'BRANCH_APPROVED',
  'DEPT_APPROVED',
  'RELIEVER_PENDING',
  'RELIEVER_CONFIRMED',
  'RELIEVER_REJECTED',
  'HR_PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
]

export const DOCUMENT_TYPES: DocumentType[] = [
  'CNIC',
  'EDUCATIONAL_CERTIFICATE',
  'MEDICAL_CERTIFICATE',
]
