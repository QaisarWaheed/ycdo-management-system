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
  status: string
  joiningDate: string
  currentDesignation: string
  currentBranch?: { name: string }
  currentDepartment?: { name: string }
  shift?: { name: string; startTime: string; endTime: string } | null
  salaryRecords?: { basicSalary: number | string; effectiveFrom: string }[]
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
  basicSalary: number | string
  totalDeductions: number | string
  totalAllowances: number | string
  netSalary: number | string
  status: string
  deductions?: PayrollDeduction[]
  allowances?: PayrollAllowance[]
  totalRelieverHours?: number
  salaryRecord?: {
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
