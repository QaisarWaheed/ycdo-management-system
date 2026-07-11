import { resolveDesignationCategoryKeys } from '@/lib/orgStructure'

export function getDesignationCategoriesForDepartment(
  departmentName: string,
  branchName?: string,
): string[] | undefined {
  const keys = resolveDesignationCategoryKeys(departmentName, branchName)
  return keys.length > 0 ? keys : undefined
}
