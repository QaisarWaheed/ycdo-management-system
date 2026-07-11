/** Keep in sync with apps/api/src/common/org-structure.ts */

export function resolveDesignationCategoryKeys(
  departmentName: string,
  branchName?: string,
): string[] {
  const dept = departmentName.trim().toUpperCase()
  if (!dept) return []

  const context = branchName ? contextForBranchName(branchName) : 'HOSPITAL'
  const key = categoryKey(context, dept)
  const keys = new Set<string>([key])

  if (dept === 'ADMIN') {
    keys.add('SHARED:ADMIN_OFFICER')
  }
  if (dept === 'KITCHEN' || dept === 'REPAIR AND DEVELOPMENT') {
    keys.add('SHARED:HELPER')
  }
  if (dept === 'GRADE 4' || dept === 'SANITARY') {
    keys.add('SHARED:SWEEPER')
  }

  return [...keys]
}

type OrgContext = 'HOSPITAL' | 'KITCHEN' | 'MEDIA' | 'VTI' | 'HEAD_OFFICE'

function categoryKey(context: OrgContext, department: string): string {
  if (department === 'ADMIN' && context === 'HOSPITAL') return 'HOSPITAL:ADMIN'
  if (department === 'ADMIN' && context === 'VTI') return 'VTI:ADMIN'
  return department
}

function contextForBranchName(branchName: string): OrgContext {
  const upper = branchName.toUpperCase()
  if (upper.includes('HEAD OFFICE')) return 'HEAD_OFFICE'
  if (upper.includes('SOFTWARE HOUSE')) return 'MEDIA'
  if (upper.includes('KITCHEN') || upper.includes('RASHAN')) return 'KITCHEN'
  if (upper.includes('VTI')) return 'VTI'
  return 'HOSPITAL'
}
