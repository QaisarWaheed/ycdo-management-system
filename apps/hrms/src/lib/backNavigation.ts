import type { NavigateFunction } from 'react-router-dom'

/** Top-level routes where a back button is not shown. */
const ROOT_PATHS = new Set([
  '/dashboard',
  '/employees',
  '/attendance',
  '/leave',
  '/branch-change-request',
  '/incentives',
  '/payroll',
  '/reports',
  '/letters',
  '/disciplinary',
  '/recruitment',
  '/broadcasts',
  '/rule-book',
  '/branch-contacts',
  '/branches',
  '/settings/profile',
  '/shifts',
  '/activity-trail',
  '/admin/employee-passwords',
  '/admin/system-logins',
])

function getParentPath(pathname: string): string | null {
  if (pathname === '/employees/new') {
    return '/employees'
  }
  if (pathname.startsWith('/employees/')) {
    return '/employees'
  }
  if (pathname.startsWith('/branches/')) {
    return '/branches'
  }
  return null
}

export function shouldShowBackButton(pathname: string): boolean {
  return !ROOT_PATHS.has(pathname)
}

export function handleAppBack(
  navigate: NavigateFunction,
  pathname: string,
  fromState?: string,
): void {
  if (fromState && fromState !== pathname) {
    navigate(fromState)
    return
  }

  if (window.history.length > 1) {
    navigate(-1)
    return
  }

  const parent = getParentPath(pathname)
  if (parent) {
    navigate(parent)
    return
  }

  navigate('/dashboard')
}

/** Pass when linking to a detail page so Back returns to the source screen. */
export function withReturnTo(fromPath: string) {
  return { state: { from: fromPath } }
}
