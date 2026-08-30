import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Header } from './Header'
import { Sidebar, SidebarNav } from './Sidebar'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'

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
  '/admin/letter-templates': 'Letter Templates',
  '/admin/appointment-letter-settings': 'Appointment Letter Settings',
  '/recruitment': 'Recruitment',
  '/broadcasts': 'Broadcasts',
  '/rule-book': 'Rule Book & Flow',
  '/branches': 'Branches & Projects',
  '/branch-contacts': 'Branch Contacts',
  '/settings/profile': 'Profile Settings',
}

function getPageTitle(pathname: string, search: string): string {
  if (pathname.startsWith('/employees/') && pathname !== '/employees/new') {
    return 'Employee Profile'
  }
  if (pathname === '/letters') {
    const section = new URLSearchParams(search).get('section')
    if (section === 'disciplinary') return 'Disciplinary'
    if (section === 'enquiries') return 'Enquiries'
    if (section === 'watchlist') return 'Suspension Watchlist'
    if (section === 'failed-whatsapp') return 'Failed WhatsApp'
    return 'Letters'
  }
  return pageTitles[pathname] ?? 'YCDO HRMS'
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { pathname, search } = useLocation()
  const title = getPageTitle(pathname, search)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="min-h-[100dvh] bg-surface">
      <Sidebar />

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="w-[min(100vw-3rem,280px)] border-0 bg-primary p-0 text-white [&>button]:text-white [&>button]:hover:bg-white/10 [&>button]:hover:text-white"
        >
          <SheetTitle className="sr-only">Navigation menu</SheetTitle>
          <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="lg:ml-[260px] print:ml-0">
        <Header
          title={title}
          onMenuClick={() => setMobileNavOpen(true)}
        />
        <main className="p-3 sm:p-4 md:p-6 print:p-0">{children}</main>
      </div>
    </div>
  )
}
