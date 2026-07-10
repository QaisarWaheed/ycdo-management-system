import { Link, useLocation } from 'react-router-dom'
import { getEmployeeDisplayName } from '@/lib/employeeDisplayName'
import { withReturnTo } from '@/lib/backNavigation'
import { cn } from '@/lib/utils'

type EmployeeLike = {
  id?: string | null
  fullName?: string | null
  firstName?: string
  lastName?: string
}

type EmployeeNameLinkProps = {
  employee?: EmployeeLike | null
  employeeId?: string | null
  name?: string | null
  className?: string
  fallback?: string
}

export function EmployeeNameLink({
  employee,
  employeeId: employeeIdProp,
  name,
  className,
  fallback = '—',
}: EmployeeNameLinkProps) {
  const location = useLocation()
  const employeeId = employeeIdProp ?? employee?.id
  const label =
    name?.trim() ||
    getEmployeeDisplayName(employee, '') ||
    fallback

  if (!employeeId || !label || label === fallback) {
    return <span className={className}>{label || fallback}</span>
  }

  return (
    <Link
      to={`/employees/${employeeId}`}
      state={withReturnTo(`${location.pathname}${location.search}`).state}
      className={cn(
        'font-medium text-primary hover:underline',
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </Link>
  )
}
