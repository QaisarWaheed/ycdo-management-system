import { Link, useLocation } from 'react-router-dom'
import { getEmployeeDisplayName } from '@/lib/employeeDisplayName'
import { withReturnTo } from '@/lib/backNavigation'
import { cn } from '@/lib/utils'

type EmployeeLike = {
  id?: string | null
  fullName?: string | null
  firstName?: string
  lastName?: string
  employeeCode?: string | null
}

type EmployeeNameLinkProps = {
  employee?: EmployeeLike | null
  employeeId?: string | null
  name?: string | null
  className?: string
  fallback?: string
}

/** Clickable employee name that supports open-in-new-tab (real href). */
export function EmployeeNameLink({
  employee,
  employeeId: employeeIdProp,
  name,
  className,
  fallback = '—',
}: EmployeeNameLinkProps) {
  const location = useLocation()
  const employeeId = (employeeIdProp ?? employee?.id)?.trim() || null
  const label =
    name?.trim() ||
    getEmployeeDisplayName(employee, '') ||
    fallback

  if (!employeeId) {
    return <span className={className}>{label || fallback}</span>
  }

  const to = `/employees/${employeeId}`
  const returnTo = `${location.pathname}${location.search}`

  return (
    <Link
      to={to}
      state={withReturnTo(returnTo).state}
      className={cn(
        'font-medium text-primary hover:underline',
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {label || fallback}
    </Link>
  )
}
