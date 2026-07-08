import type { Department } from '@/types'

export function findDepartmentByName(
  departments: Department[],
  name: string,
): Department | undefined {
  const q = name.trim().toLowerCase()
  return departments.find((d) => d.name.toLowerCase() === q)
}
