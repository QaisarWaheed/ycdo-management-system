import type { LetterType } from '@/types'

export interface LetterFieldDef {
  key: string
  label: string
  type?: 'textarea' | 'number' | 'date'
  hint?: string
  /** Place this field inside the on-template canvas (Urdu RTL). */
  onTemplate?: boolean
}

/** Shared identity fields typed in Urdu on the letter itself. */
const URDU_IDENTITY_FIELDS: LetterFieldDef[] = [
  {
    key: 'employeeName',
    label: 'نام (بجانب)',
    onTemplate: true,
    hint: 'اردو میں نام لکھیں',
  },
  {
    key: 'designation',
    label: 'عہدہ',
    onTemplate: true,
    hint: 'اردو میں عہدہ لکھیں',
  },
  {
    key: 'branch',
    label: 'برانچ / مقام',
    onTemplate: true,
    hint: 'اردو میں برانچ لکھیں',
  },
  {
    key: 'senderTitle',
    label: 'منجانب',
    onTemplate: true,
    hint: 'مثلاً: کوآرڈینیٹر پروجیکٹس',
  },
]

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
    ...URDU_IDENTITY_FIELDS,
    {
      key: 'violations',
      label: 'خلاف ورزیاں (ہر سطر ایک خلاف ورزی)',
      type: 'textarea',
      onTemplate: true,
      hint: 'اردو میں لکھیں — ہر لائن الگ خلاف ورزی بنے گی',
    },
  ],
  ADVICE: [
    ...URDU_IDENTITY_FIELDS,
    {
      key: 'adviceReason',
      label: 'وجہ / تفصیل',
      type: 'textarea',
      onTemplate: true,
      hint: 'اردو میں لکھیں',
    },
    {
      key: 'adviceDetails',
      label: 'اضافی ہدایت (اختیاری)',
      type: 'textarea',
      onTemplate: true,
    },
  ],
  DISCIPLINARY: [
    ...URDU_IDENTITY_FIELDS,
    {
      key: 'disciplinaryReason',
      label: 'تفصیلِ واقعہ',
      type: 'textarea',
      onTemplate: true,
      hint: 'اردو میں لکھیں',
    },
    { key: 'incidentDate', label: 'تاریخِ واقعہ', type: 'date', onTemplate: true },
  ],
  EXPLANATION: [
    ...URDU_IDENTITY_FIELDS,
    {
      key: 'issueDescription',
      label: 'مسئلہ / تفصیل',
      type: 'textarea',
      onTemplate: true,
      hint: 'اردو میں لکھیں',
    },
    {
      key: 'responseDeadline',
      label: 'آخری تاریخِ جواب',
      type: 'date',
      onTemplate: true,
    },
  ],
  SHOW_CAUSE: [
    ...URDU_IDENTITY_FIELDS,
    {
      key: 'allegation',
      label: 'الزام / تفصیل',
      type: 'textarea',
      onTemplate: true,
      hint: 'اردو میں لکھیں',
    },
    {
      key: 'responseDeadline',
      label: 'آخری تاریخِ جواب',
      type: 'date',
      onTemplate: true,
    },
  ],
  FINE: [
    ...URDU_IDENTITY_FIELDS,
    {
      key: 'fineReason',
      label: 'وجہِ جرمانہ',
      type: 'textarea',
      onTemplate: true,
      hint: 'اردو میں لکھیں',
    },
    {
      key: 'fineAmount',
      label: 'رقم / کٹوتی (مثلاً 500/- یا دو یوم تنخواہ)',
      onTemplate: true,
    },
    {
      key: 'deductionMonth',
      label: 'ماہِ کٹوتی',
      onTemplate: true,
      hint: 'مثلاً: اگست 2026',
    },
    {
      key: 'attendanceRows',
      label: 'حاضری ثبوت (اختیاری)',
      type: 'textarea',
      hint: 'ہر سطر: تاریخ | آمد | روانگی',
    },
  ],
  INQUIRY: [
    ...URDU_IDENTITY_FIELDS,
    {
      key: 'inquiryReason',
      label: 'وجہِ انکوائری',
      type: 'textarea',
      onTemplate: true,
      hint: 'اردو میں لکھیں',
    },
    { key: 'inquiryDate', label: 'تاریخِ انکوائری', type: 'date', onTemplate: true },
    {
      key: 'committeeMembers',
      label: 'کمیٹی ممبران',
      onTemplate: true,
    },
  ],
  APPRECIATION: [
    ...URDU_IDENTITY_FIELDS,
    {
      key: 'appreciationReason',
      label: 'وجہِ تعریف',
      type: 'textarea',
      onTemplate: true,
      hint: 'اردو میں لکھیں',
    },
    {
      key: 'achievementDetails',
      label: 'تفصیلِ کارکردگی',
      type: 'textarea',
      onTemplate: true,
    },
    { key: 'rewardAmount', label: 'انعام کی رقم (اختیاری)', onTemplate: true },
  ],
  TRANSFER: [
    { key: 'fromBranch', label: 'From Branch / Posting' },
    { key: 'toBranch', label: 'To Branch / Posting' },
    { key: 'effectiveDate', label: 'Effective Date', type: 'date' },
    { key: 'timing', label: 'Timing (optional)' },
    { key: 'senderTitle', label: 'Signatory Title (optional)' },
  ],
  SUSPENSION: [
    ...URDU_IDENTITY_FIELDS,
    {
      key: 'suspensionReason',
      label: 'وجہِ معطلی',
      type: 'textarea',
      onTemplate: true,
      hint: 'اردو میں لکھیں',
    },
    {
      key: 'suspensionStartDate',
      label: 'آغاز تاریخ',
      type: 'date',
      onTemplate: true,
    },
    { key: 'suspensionDuration', label: 'مدت', onTemplate: true },
  ],
  TERMINATION: [
    ...URDU_IDENTITY_FIELDS,
    {
      key: 'terminationReason',
      label: 'وجہِ ختمِ ملازمت',
      type: 'textarea',
      onTemplate: true,
      hint: 'اردو میں لکھیں',
    },
    {
      key: 'terminationDate',
      label: 'آخری یومِ ملازمت',
      type: 'date',
      onTemplate: true,
    },
    {
      key: 'settlementDetails',
      label: 'تصفیہ کی تفصیل',
      type: 'textarea',
      onTemplate: true,
    },
    {
      key: 'violations',
      label: 'خلاف ورزیاں (اختیاری، ہر سطر ایک)',
      type: 'textarea',
      onTemplate: true,
    },
  ],
  REINSTATEMENT: [
    ...URDU_IDENTITY_FIELDS,
    {
      key: 'reinstatementDate',
      label: 'تاریخِ بحالی',
      type: 'date',
      onTemplate: true,
    },
    {
      key: 'reinstatedDesignation',
      label: 'عہدہِ بحالی',
      onTemplate: true,
    },
  ],
  REJOINING: [
    ...URDU_IDENTITY_FIELDS,
    {
      key: 'rejoiningDate',
      label: 'تاریخِ واپسی',
      type: 'date',
      onTemplate: true,
    },
    {
      key: 'rejoiningDesignation',
      label: 'عہدہ',
      onTemplate: true,
    },
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
    ...URDU_IDENTITY_FIELDS,
    {
      key: 'lastWorkingDate',
      label: 'آخری یومِ ملازمت',
      type: 'date',
      onTemplate: true,
    },
    { key: 'totalExperience', label: 'کل تجربہ', onTemplate: true },
    {
      key: 'jobDescription',
      label: 'ذمہ داریاں',
      type: 'textarea',
      onTemplate: true,
      hint: 'اردو میں لکھیں',
    },
  ],
}

const ENGLISH_LETTER_TYPES = new Set<LetterType>(['APPOINTMENT'])

export function isUrduLetterType(letterType: LetterType): boolean {
  return !ENGLISH_LETTER_TYPES.has(letterType)
}

export function getLetterExtraFields(letterType: LetterType): LetterFieldDef[] {
  return (
    LETTER_FIELD_CONFIG[letterType] ?? [
      { key: 'additionalNotes', label: 'Additional Notes', type: 'textarea' },
    ]
  )
}

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
    'designation',
    'branch',
    'department',
  ])

  if (letterType === 'WARNING') {
    return getLetterExtraFields(letterType).filter((f) =>
      ['employeeName', 'violations'].includes(f.key),
    )
  }

  if (letterType === 'TERMINATION') {
    return getLetterExtraFields(letterType).filter(
      (f) =>
        !optionalKeys.has(f.key) &&
        f.key !== 'violations' &&
        f.key !== 'employeeName',
    ).concat(
      getLetterExtraFields(letterType).filter((f) => f.key === 'employeeName'),
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

/** Default Urdu subjects shown on the canvas / PDF (centered title). */
export const URDU_LETTER_SUBJECT: Partial<Record<LetterType, string>> = {
  WARNING: 'لیٹر آف وارننگ',
  ADVICE: 'ایڈوائس لیٹر',
  DISCIPLINARY: 'لیٹر آف ڈسپلیژر',
  EXPLANATION: 'تحریری وضاحت طلب',
  SHOW_CAUSE: 'شو کاز نوٹس',
  FINE: 'فائن / جرمانہ نوٹس',
  INQUIRY: 'انکوائری نوٹس',
  APPRECIATION: 'تعریفی خط',
  TRANSFER: 'ٹرانسفر / پوسٹنگ نوٹیفکیشن',
  SUSPENSION: 'معطلی نوٹس',
  TERMINATION: 'ختمِ ملازمت',
  REINSTATEMENT: 'بحالیِ ملازمت',
  REJOINING: 'واپسیِ ملازمت',
  SALARY_INCREMENT: 'تنخواہ / الاؤنس اضافہ',
  EXPERIENCE: 'تجربہ سرٹیفکیٹ',
}
