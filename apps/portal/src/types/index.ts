export interface User {
  id: string
  email: string
  role: string
  employeeId?: string | null
}

export interface AuthLoginResponse {
  access_token: string
  user: User
}

export interface Employee {
  id: string
  employeeCode: string
  firstName: string
  lastName: string
  cnic: string
  phone?: string | null
  email?: string | null
  dateOfBirth?: string | null
  gender: string
  address?: string | null
  currentAddress?: string | null
  permanentAddress?: string | null
  province?: string | null
  city?: string | null
  domicile?: string | null
  dutyStartTime?: string | null
  dutyEndTime?: string | null
  status: string
  joiningDate: string
  currentDesignation: string
  currentBranch?: { name: string }
  currentDepartment?: { name: string }
  shift?: { name: string; startTime: string; endTime: string } | null
  stipendRecords?: { basicStipend: number | string; effectiveFrom: string }[]
  documents?: EmployeeDocument[]
}

export interface EmployeeDocument {
  id: string
  documentType: string
  fileName: string
  fileUrl: string
  uploadedAt: string
}

export interface AttendanceLog {
  id: string
  date: string
  checkIn?: string | null
  checkOut?: string | null
  status: string
  lateMinutes?: number
  overtimeMinutes?: number
}

export interface WorkingHours {
  totalMinutes: number
  totalHours: number
  totalDays: number
  thisMonthMinutes: number
  thisMonthHours: number
  averageDailyHours: number
}

export interface AttendanceSummary {
  totalDays: number
  present: number
  absent: number
  late: number
  halfDay: number
  onLeave: number
  uninformedAbsent: number
  overtimeMinutes: number
  totalLateMinutes: number
}

export interface ActiveTimer {
  primaryShift: {
    checkedIn: boolean
    checkIn: string | null
    checkOut: string | null
    isActive: boolean
  }
  reliever: {
    isActive: boolean
    checkIn: string | null
    session: { id: string; checkIn: string; checkOut?: string | null } | null
  }
}

export interface RelieverSession {
  id: string
  date: string
  checkIn: string
  checkOut?: string | null
  totalMinutes: number
}

export interface RelieverSummary {
  sessions: RelieverSession[]
  totalMinutes: number
  totalHours: number
}

export interface LeaveRecord {
  id: string
  startDate: string
  endDate: string
  totalDays: number
  status: string
  reason?: string | null
  createdAt?: string
  relieverRequest?: {
    id: string
    status: string
    reliever?: { firstName: string; lastName: string }
  } | null
}

export interface LeaveBalance {
  employeeId: string
  year: number
  totalAllowed: number
  taken: number
  remaining: number
  pending: number
}

export interface PayrollEntry {
  id: string
  month: number
  year: number
  basicStipend: number | string
  totalDeductions: number | string
  totalAllowances: number | string
  netStipend: number | string
  status: string
  deductions?: PayrollDeduction[]
  allowances?: PayrollAllowance[]
  totalRelieverHours?: number
  stipendRecord?: {
    employee?: Employee
  }
}

export interface PayrollDeduction {
  id: string
  reason: string
  amount: number | string
  description?: string | null
}

export interface PayrollAllowance {
  id: string
  type: string
  amount: number | string
  description?: string | null
  hours?: number | string | null
}

export interface Letter {
  id: string
  letterType: string
  fileUrl?: string | null
  generatedAt: string
  content?: Record<string, unknown>
  replyDeadline?: string | null
  isReplied?: boolean
  autoEscalated?: boolean
  requiresAcknowledgement?: boolean
}

export interface BranchChangeRequest {
  id: string
  employeeId: string
  district: string
  purpose: string
  startDate: string
  endDate: string
  duration: number
  status: string
  notes?: string | null
  createdAt: string
}

export type StipendStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'AUTO_ACCEPTED'

export interface StipendReceipt {
  id: string
  employeeId: string
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
}

export interface Incentive {
  id: string
  employeeId: string
  amount: number | string
  reason: string
  month: number
  year: number
  createdAt: string
}

/** @deprecated Use BranchChangeRequest */
export type OutstationRequest = BranchChangeRequest

export interface AllegationAcknowledgement {
  id: string
  letterId: string
  employeeId: string
  acknowledgedAt: string
  ipAddress?: string | null
}

export interface LetterReply {
  id: string
  letterId: string
  replyText: string
  repliedAt: string
}

export interface Notification {
  id: string
  message: string
  type: string
  isRead: boolean
  createdAt: string
}
