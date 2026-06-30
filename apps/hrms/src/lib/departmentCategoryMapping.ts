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

export function getDesignationCategoriesForDepartment(
  departmentName: string,
): string[] | undefined {
  const key = departmentName.trim().toLowerCase()
  if (DEPARTMENT_CATEGORY_MAP[key]) {
    return DEPARTMENT_CATEGORY_MAP[key]
  }

  for (const [dept, categories] of Object.entries(DEPARTMENT_CATEGORY_MAP)) {
    if (key.includes(dept) || dept.includes(key)) {
      return categories
    }
  }

  return undefined
}
