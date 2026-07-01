import type { QueryClient } from '@tanstack/react-query'
import { departmentsApi } from '@/api/endpoints/departments'
import { designationsApi } from '@/api/endpoints/designations'
import { getDesignationCategoriesForDepartment } from '@/lib/departmentCategoryMapping'
import { toast } from '@/hooks/use-toast'
import type { Department } from '@/types'

function apiErrorMessage(err: unknown): string {
  const msg = (err as { response?: { data?: { message?: string | string[] } } })
    ?.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Request failed')
}

export function resolveDesignationCategory(departmentName: string): string {
  const categories = getDesignationCategoriesForDepartment(departmentName)
  return categories?.[0] ?? 'Other'
}

export async function createDepartmentInline(
  queryClient: QueryClient,
  branchId: string,
  name: string,
): Promise<Department | null> {
  const trimmed = name.trim()
  if (!trimmed) return null

  try {
    const created = await departmentsApi.create({
      name: trimmed,
      branchId,
    })

    queryClient.setQueryData<Department[]>(
      ['departments', branchId],
      (old = []) => {
        if (old.some((d) => d.id === created.id)) return old
        return [...old, created]
      },
    )
    await queryClient.invalidateQueries({ queryKey: ['departments', branchId] })

    toast({ title: `Department "${trimmed}" added` })
    return created
  } catch (err) {
    toast({
      title: 'Failed to add department',
      description: apiErrorMessage(err),
      variant: 'destructive',
    })
    return null
  }
}

export async function createDesignationInline(
  queryClient: QueryClient,
  departmentName: string,
  title: string,
): Promise<string | null> {
  const trimmed = title.trim()
  if (!trimmed) return null

  const category = resolveDesignationCategory(departmentName)

  try {
    await designationsApi.create({ title: trimmed, category })
    await queryClient.invalidateQueries({ queryKey: ['designations'] })
    toast({ title: `Designation "${trimmed}" added` })
    return trimmed
  } catch (err) {
    try {
      const existing = await designationsApi.getAll()
      const match = existing.find(
        (d) => d.title.toLowerCase() === trimmed.toLowerCase(),
      )
      if (match) {
        return match.title
      }
    } catch {
      // fall through to error toast
    }

    toast({
      title: 'Failed to add designation',
      description: apiErrorMessage(err),
      variant: 'destructive',
    })
    return null
  }
}

export function findDepartmentByName(
  departments: Department[],
  name: string,
): Department | undefined {
  const q = name.trim().toLowerCase()
  return departments.find((d) => d.name.toLowerCase() === q)
}
