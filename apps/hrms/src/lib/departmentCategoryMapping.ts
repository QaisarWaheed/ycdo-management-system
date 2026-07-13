const DEPARTMENT_CATEGORY_MAP: Record<string, string[]> = {
  'human resources': ['HR', 'Management'],
  administration: ['Admin', 'Management'],
  'medical staff': ['Medical', 'Nursing'],
  reception: ['Admin'],
  pharmacy: ['Allied Health'],
  laboratory: ['Allied Health'],
  housekeeping: ['Support'],
  emergency: ['Medical', 'Nursing'],
  kitchen: ['Kitchen'],
  it: ['IT'],
  software: ['IT'],
  finance: ['Finance'],
  accounts: ['Finance'],
  vti: ['VTI'],
  vocational: ['VTI'],
}

/**
 * Categories used to load designations for a department on employee forms.
 * Includes the department name itself (how IT stores new designations)
 * plus legacy category labels for older records.
 */
export function getDesignationCategoriesForDepartment(
  departmentName: string,
): string[] {
  const trimmed = departmentName.trim()
  if (!trimmed) return []

  const categories = new Set<string>([trimmed])
  const key = trimmed.toLowerCase()

  const exact = DEPARTMENT_CATEGORY_MAP[key]
  if (exact) {
    for (const category of exact) categories.add(category)
  }

  for (const [dept, legacyCategories] of Object.entries(
    DEPARTMENT_CATEGORY_MAP,
  )) {
    if (key.includes(dept) || dept.includes(key)) {
      for (const category of legacyCategories) categories.add(category)
    }
  }

  return [...categories]
}
