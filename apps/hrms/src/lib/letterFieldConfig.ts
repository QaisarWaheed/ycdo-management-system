import type { LetterType } from '@/types'

export interface LetterFieldDef {
  key: string
  label: string
  type?: 'textarea' | 'number' | 'date'
  hint?: string
}

export const LETTER_FIELD_CONFIG: Partial<
  Record<LetterType, LetterFieldDef[]>
> = {
  APPOINTMENT: [
    { key: 'stipendAmount', label: 'Stipend Amount (Rs.)', type: 'number' },
    { key: 'hoursPerDay', label: 'Hours Per Day', type: 'number' },
    { key: 'shiftName', label: 'Shift Name' },
    { key: 'capacity', label: 'Capacity (e.g. Full Time)' },
  ],
  WARNING: [
    {
      key: 'violations',
      label: 'Violations / خلاف ورزیاں (one per line)',
      type: 'textarea',
      hint: 'Each line becomes a violation bullet on the Urdu warning template.',
    },
    { key: 'senderTitle', label: 'From / منجانب (optional)' },
  ],
  ADVICE: [
    { key: 'adviceReason', label: 'Advice Reason', type: 'textarea' },
    { key: 'adviceDetails', label: 'Additional Details', type: 'textarea' },
    { key: 'senderTitle', label: 'From / منجانب (optional)' },
  ],
  DISCIPLINARY: [
    {
      key: 'disciplinaryReason',
      label: 'Reason / Incident Detail',
      type: 'textarea',
    },
    { key: 'incidentDate', label: 'Incident Date', type: 'date' },
    { key: 'senderTitle', label: 'From / منجانب (optional)' },
  ],
  EXPLANATION: [
    {
      key: 'issueDescription',
      label: 'Issue Description',
      type: 'textarea',
    },
    { key: 'responseDeadline', label: 'Response Deadline', type: 'date' },
    { key: 'senderTitle', label: 'From / منجانب (optional)' },
  ],
  SHOW_CAUSE: [
    { key: 'allegation', label: 'Allegation', type: 'textarea' },
    { key: 'responseDeadline', label: 'Response Deadline', type: 'date' },
    { key: 'senderTitle', label: 'From / منجانب (optional)' },
  ],
  FINE: [
    { key: 'fineReason', label: 'Fine Reason', type: 'textarea' },
    { key: 'fineAmount', label: 'Fine Amount (e.g. 500/- or ایک یوم تنخواہ)' },
    { key: 'deductionMonth', label: 'Deduction Month' },
    {
      key: 'attendanceRows',
      label: 'Late evidence rows (optional)',
      type: 'textarea',
      hint: 'One per line: date | inTime | outTime  — or JSON array.',
    },
    { key: 'senderTitle', label: 'From / منجانب (optional)' },
  ],
  INQUIRY: [
    { key: 'inquiryReason', label: 'Inquiry Reason', type: 'textarea' },
    { key: 'inquiryDate', label: 'Inquiry Date', type: 'date' },
    { key: 'committeeMembers', label: 'Committee Members' },
    { key: 'senderTitle', label: 'From / منجانب (optional)' },
  ],
  APPRECIATION: [
    { key: 'appreciationReason', label: 'Reason', type: 'textarea' },
    {
      key: 'achievementDetails',
      label: 'Achievement Details',
      type: 'textarea',
    },
    { key: 'rewardAmount', label: 'Reward Amount (optional)' },
    { key: 'senderTitle', label: 'From / منجانب (optional)' },
  ],
  TRANSFER: [
    { key: 'fromBranch', label: 'From Branch / Posting' },
    { key: 'toBranch', label: 'To Branch / Posting' },
    { key: 'effectiveDate', label: 'Effective Date', type: 'date' },
    { key: 'timing', label: 'Timing (optional)' },
    { key: 'senderTitle', label: 'Signatory Title (optional)' },
  ],
  SUSPENSION: [
    {
      key: 'suspensionReason',
      label: 'Suspension Reason',
      type: 'textarea',
    },
    { key: 'suspensionStartDate', label: 'Start Date', type: 'date' },
    { key: 'suspensionDuration', label: 'Duration' },
    { key: 'senderTitle', label: 'From / منجانب (optional)' },
  ],
  TERMINATION: [
    {
      key: 'terminationReason',
      label: 'Termination Reason',
      type: 'textarea',
    },
    { key: 'terminationDate', label: 'Termination Date', type: 'date' },
    {
      key: 'settlementDetails',
      label: 'Settlement Details',
      type: 'textarea',
    },
    {
      key: 'violations',
      label: 'Violations (optional, one per line)',
      type: 'textarea',
    },
    { key: 'senderTitle', label: 'From / منجانب (optional)' },
  ],
  REINSTATEMENT: [
    { key: 'reinstatementDate', label: 'Reinstatement Date', type: 'date' },
    { key: 'reinstatedDesignation', label: 'Reinstated Designation' },
    { key: 'senderTitle', label: 'From / منجانب (optional)' },
  ],
  REJOINING: [
    { key: 'rejoiningDate', label: 'Rejoining Date', type: 'date' },
    { key: 'rejoiningDesignation', label: 'Rejoining Designation' },
    { key: 'senderTitle', label: 'From / منجانب (optional)' },
  ],
  SALARY_INCREMENT: [
    { key: 'previousSalary', label: 'Previous Stipend', type: 'number' },
    { key: 'newSalary', label: 'New Stipend', type: 'number' },
    { key: 'effectiveDate', label: 'Effective Date', type: 'date' },
    {
      key: 'incrementReason',
      label: 'Increment Reason (optional)',
      type: 'textarea',
    },
    { key: 'senderTitle', label: 'Signatory Title (optional)' },
  ],
  EXPERIENCE: [
    { key: 'lastWorkingDate', label: 'Last Working Date', type: 'date' },
    { key: 'totalExperience', label: 'Total Experience' },
    { key: 'jobDescription', label: 'Job Description', type: 'textarea' },
    { key: 'senderTitle', label: 'From / منجانب (optional)' },
  ],
}

export function getLetterExtraFields(letterType: LetterType): LetterFieldDef[] {
  return (
    LETTER_FIELD_CONFIG[letterType] ?? [
      { key: 'additionalNotes', label: 'Additional Notes', type: 'textarea' },
    ]
  )
}

/** Required for generate button — optional fields like senderTitle are skipped. */
export function getLetterRequiredFields(
  letterType: LetterType,
): LetterFieldDef[] {
  const optionalKeys = new Set([
    'senderTitle',
    'adviceDetails',
    'attendanceRows',
    'rewardAmount',
    'timing',
    'incrementReason',
    'violations', // optional on TERMINATION only; WARNING treats as required via config presence
    'totalExperience',
    'jobDescription',
    'reinstatedDesignation',
    'rejoiningDesignation',
    'settlementDetails',
    'committeeMembers',
    'inquiryDate',
    'responseDeadline',
    'incidentDate',
    'suspensionStartDate',
    'suspensionDuration',
    'terminationDate',
  ])

  // WARNING violations is required
  if (letterType === 'WARNING') {
    return getLetterExtraFields(letterType).filter(
      (f) => f.key === 'violations',
    )
  }

  return getLetterExtraFields(letterType).filter(
    (f) => !optionalKeys.has(f.key),
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
  letterNo?: string | null
  fileUrl?: string | null
  id: string
}): string {
  if (letter.letterNo) return letter.letterNo
  if (letter.fileUrl && !letter.fileUrl.startsWith('http')) {
    const name = letter.fileUrl.split('/').pop() ?? ''
    return name.replace(/\.pdf$/i, '').replace(/_/g, '/')
  }
  return letter.id.slice(0, 8).toUpperCase()
}

export function isLetterPdfUnavailable(letter: {
  fileUrl?: string | null
}): boolean {
  return !letter.fileUrl
}
