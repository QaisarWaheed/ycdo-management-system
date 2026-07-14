import { useLocation } from 'react-router-dom'
import { Header } from './Header'
import { Sidebar } from './Sidebar'

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/employees': 'Employees',
  '/employees/new': 'Add Employee',
  '/shifts': 'Shifts',
  '/activity-trail': 'Activity Trail',
  '/admin/employee-passwords': 'Employee Logins',
  '/admin/system-logins': 'System Logins',
  '/attendance': 'Attendance',
  '/leave': 'Leave Management',
  '/payroll': 'Payroll',
  '/letters': 'Letters',
  '/disciplinary': 'Disciplinary',
  '/recruitment': 'Recruitment',
  '/broadcasts': 'Broadcasts',
  '/rule-book': 'Rule Book & Flow',
  '/branches': 'Branches & Projects',
  '/settings/profile': 'Profile Settings',
}

function getPageTitle(pathname: string): string {
  if (pathname.startsWith('/employees/') && pathname !== '/employees/new') {
    return 'Employee Profile'
  }
  return pageTitles[pathname] ?? 'YCDO HRMS'
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const title = getPageTitle(pathname)

  return (
    <div className="min-h-screen bg-surface">
      <Sidebar />
      <div className="ml-[260px] print:ml-0">
        <Header title={title} />
        <main className="p-6 print:p-0">{children}</main>
      </div>
    </div>
  )
}
