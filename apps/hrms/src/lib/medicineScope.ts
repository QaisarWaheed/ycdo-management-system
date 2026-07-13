/** Mirrors API medicine scope for UI filters. */
export const MEDICINE_DEPARTMENT_NAME = 'MEDICINE MANAGEMENT SYSTEM'

export const MEDICINE_DESIGNATIONS = [
  'MEDICINE MANAGER',
  'ASSISTANT DISPERSAL',
  'AUDIT OFFICER',
  'LAB MEDICINE',
  'ASSISTANT AUDIT OFFICER',
] as const

export function isMedicineManagerRole(role?: string | null) {
  return role === 'MEDICINE_MANAGER'
}

export function isMedicineDepartmentName(name?: string | null) {
  return name?.trim().toUpperCase() === MEDICINE_DEPARTMENT_NAME
}
