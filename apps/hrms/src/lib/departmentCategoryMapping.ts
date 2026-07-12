export function getDesignationCategoriesForDepartment(
  departmentName: string,
  _branchName?: string,
): string[] | undefined {
  const dept = departmentName.trim().toUpperCase()
  return dept ? [dept] : undefined
}
