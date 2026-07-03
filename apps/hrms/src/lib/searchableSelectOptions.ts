import type { Gender } from '@/types'

export const BLOOD_GROUP_OPTIONS = [
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
  'O+',
  'O-',
]

export const GENDER_LABELS: Record<Gender, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
}

export const GENDER_OPTIONS = Object.values(GENDER_LABELS)

export function genderToLabel(value: string): string {
  return GENDER_LABELS[value as Gender] ?? value
}

export function labelToGender(label: string): Gender {
  const entry = Object.entries(GENDER_LABELS).find(([, l]) => l === label)
  return (entry?.[0] ?? label) as Gender
}

export const SHIFT_NAME_OPTIONS = ['Morning', 'Evening', 'Night', '24 Hours']

export const MARITAL_STATUS_OPTIONS = [
  { label: 'Married', value: 'MARRIED' },
  { label: 'Unmarried', value: 'UNMARRIED' },
  { label: 'Divorced', value: 'DIVORCED' },
  { label: 'Widow', value: 'WIDOW' },
] as const

export const MARITAL_STATUS_LABELS = MARITAL_STATUS_OPTIONS.map((o) => o.label)

export function maritalStatusToLabel(value: string): string {
  return MARITAL_STATUS_OPTIONS.find((o) => o.value === value)?.label ?? value
}

export function labelToMaritalStatus(label: string): string {
  return MARITAL_STATUS_OPTIONS.find((o) => o.label === label)?.value ?? label
}

export const FATHER_STATUS_OPTIONS = [
  { label: 'Alive', value: 'ALIVE' },
  { label: 'Deceased', value: 'DECEASED' },
] as const

export const FATHER_STATUS_LABELS = FATHER_STATUS_OPTIONS.map((o) => o.label)

export function fatherStatusToLabel(value: string): string {
  return FATHER_STATUS_OPTIONS.find((o) => o.value === value)?.label ?? value
}

export function labelToFatherStatus(label: string): string {
  return FATHER_STATUS_OPTIONS.find((o) => o.label === label)?.value ?? label
}

export const CHANGE_TYPE_LABELS: Record<string, string> = {
  TRANSFERRED: 'Transferred',
  PROMOTED: 'Promoted',
  DEMOTED: 'Demoted',
}

export const CHANGE_TYPE_OPTIONS = Object.values(CHANGE_TYPE_LABELS)

export function changeTypeToLabel(value: string): string {
  return CHANGE_TYPE_LABELS[value] ?? value
}

export function labelToChangeType(label: string): string {
  const entry = Object.entries(CHANGE_TYPE_LABELS).find(([, l]) => l === label)
  return entry?.[0] ?? label
}

export const LEAVE_TYPE_LABELS: Record<string, string> = {
  REGULAR: 'Regular Leave',
  SHORT_LEAVE: 'Short Leave',
  EMERGENCY: 'Emergency Leave',
}

export const LEAVE_TYPE_OPTIONS = Object.values(LEAVE_TYPE_LABELS)

export function leaveTypeToLabel(value: string): string {
  return LEAVE_TYPE_LABELS[value] ?? value
}

export function labelToLeaveType(label: string): string {
  const entry = Object.entries(LEAVE_TYPE_LABELS).find(([, l]) => l === label)
  return entry?.[0] ?? label
}

export function formatEnumLabel(value: string): string {
  return value.replace(/_/g, ' ')
}

export function labelToEnumValue(label: string, values: string[]): string {
  return values.find((v) => formatEnumLabel(v) === label) ?? label
}

export function enumValueToLabel(value: string): string {
  return formatEnumLabel(value)
}
