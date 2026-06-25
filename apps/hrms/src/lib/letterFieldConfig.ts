import type { LetterType } from '@/types'

export interface LetterFieldDef {
  key: string
  label: string
  type?: 'textarea' | 'number' | 'date'
}

export const LETTER_FIELD_CONFIG: Partial<
  Record<LetterType, LetterFieldDef[]>
> = {
  WARNING: [
    { key: 'warningReason', label: 'Warning Reason', type: 'textarea' },
    { key: 'incidentDate', label: 'Incident Date', type: 'date' },
    { key: 'warningNumber', label: 'Warning Number (1st/2nd/3rd)' },
  ],
  FINE: [
    { key: 'fineReason', label: 'Fine Reason', type: 'textarea' },
    { key: 'fineAmount', label: 'Fine Amount', type: 'number' },
    { key: 'deductionMonth', label: 'Deduction Month' },
  ],
  SUSPENSION: [
    { key: 'suspensionReason', label: 'Suspension Reason', type: 'textarea' },
    { key: 'suspensionStartDate', label: 'Start Date', type: 'date' },
    { key: 'suspensionDuration', label: 'Duration' },
  ],
  TERMINATION: [
    { key: 'terminationReason', label: 'Termination Reason', type: 'textarea' },
    { key: 'terminationDate', label: 'Termination Date', type: 'date' },
    { key: 'settlementDetails', label: 'Settlement Details', type: 'textarea' },
  ],
  SHOW_CAUSE: [
    { key: 'allegation', label: 'Allegation', type: 'textarea' },
    { key: 'responseDeadline', label: 'Response Deadline', type: 'date' },
  ],
  APPRECIATION: [
    { key: 'appreciationReason', label: 'Reason', type: 'textarea' },
    { key: 'achievementDetails', label: 'Achievement Details', type: 'textarea' },
  ],
  TRANSFER: [
    { key: 'fromBranch', label: 'From Branch' },
    { key: 'toBranch', label: 'To Branch' },
    { key: 'effectiveDate', label: 'Effective Date', type: 'date' },
  ],
  EXPERIENCE: [
    { key: 'lastWorkingDate', label: 'Last Working Date', type: 'date' },
    { key: 'totalExperience', label: 'Total Experience' },
    { key: 'jobDescription', label: 'Job Description', type: 'textarea' },
  ],
  SALARY_INCREMENT: [
    { key: 'previousSalary', label: 'Previous Stipend', type: 'number' },
    { key: 'newSalary', label: 'New Stipend', type: 'number' },
    { key: 'effectiveDate', label: 'Effective Date', type: 'date' },
    { key: 'incrementReason', label: 'Increment Reason', type: 'textarea' },
  ],
  REINSTATEMENT: [
    { key: 'reinstatementDate', label: 'Reinstatement Date', type: 'date' },
    { key: 'reinstatedDesignation', label: 'Reinstated Designation' },
  ],
  REJOINING: [
    { key: 'rejoiningDate', label: 'Rejoining Date', type: 'date' },
    { key: 'rejoiningDesignation', label: 'Rejoining Designation' },
  ],
  INQUIRY: [
    { key: 'inquiryReason', label: 'Inquiry Reason', type: 'textarea' },
    { key: 'inquiryDate', label: 'Inquiry Date', type: 'date' },
    { key: 'committeeMembers', label: 'Committee Members' },
  ],
}

export function getLetterExtraFields(letterType: LetterType): LetterFieldDef[] {
  return (
    LETTER_FIELD_CONFIG[letterType] ?? [
      { key: 'additionalNotes', label: 'Additional Notes', type: 'textarea' },
    ]
  )
}

const DISCIPLINARY_TYPES: LetterType[] = [
  'WARNING',
  'SHOW_CAUSE',
  'FINE',
  'SUSPENSION',
  'TERMINATION',
  'DISCIPLINARY',
]

const POSITIVE_TYPES: LetterType[] = [
  'APPRECIATION',
  'APPOINTMENT',
  'REINSTATEMENT',
  'REJOINING',
  'SALARY_INCREMENT',
  'EXPERIENCE',
]

export function letterTypeBadgeClass(type: string): string {
  if (DISCIPLINARY_TYPES.includes(type as LetterType)) {
    return 'bg-red-100 text-red-800 border-red-200'
  }
  if (POSITIVE_TYPES.includes(type as LetterType)) {
    return 'bg-green-100 text-green-800 border-green-200'
  }
  return 'bg-blue-100 text-blue-800 border-blue-200'
}

export function letterReference(letter: {
  fileUrl?: string | null
  id: string
}): string {
  if (letter.fileUrl) {
    const name = letter.fileUrl.split('/').pop() ?? ''
    return name.replace(/\.pdf$/i, '').replace(/_/g, '/')
  }
  return letter.id.slice(0, 8).toUpperCase()
}
