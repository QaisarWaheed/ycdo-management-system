import { NavLink, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  Calendar,
  Clock,
  Database,
  FileText,
  Fingerprint,
  Gift,
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  Monitor,
  Phone,
  Shield,
  ShieldCheck,
  Timer,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmployeeAvatar } from '@/components/employees/EmployeeAvatar'

const allNavItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/employees', label: 'Employees', icon: Users },
  { to: '/portal-login', label: 'Portal Login', icon: Monitor },
  { to: '/attendance', label: 'Attendance', icon: Clock },
  { to: '/branch-change-request', label: 'Station / Branch Change', icon: MapPin },
  { to: '/leave', label: 'Leave', icon: Calendar },
  { to: '/branch-contacts', label: 'Branch Contacts', icon: Phone },
  { to: '/payroll', label: 'Payroll', icon: Wallet },
  { to: '/incentives', label: 'Incentives', icon: Gift },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/letters', label: 'Letters', icon: FileText },
  { to: '/recruitment', label: 'Recruitment', icon: UserPlus },
  { to: '/broadcasts', label: 'Broadcasts', icon: Bell },
  { to: '/branches', label: 'Branches & Projects', icon: Building2 },
]

const itTeamNavItems = [
  { to: '/admin/master-data', label: 'Master Data', icon: Database },
  { to: '/admin/roles', label: 'Roles & Access', icon: ShieldCheck },
  { to: '/admin/login-access', label: 'Login Access', icon: Shield },
  { to: '/admin/letter-templates', label: 'Letter Templates', icon: FileText },
]

const activityTrailNavItem = {
  to: '/activity-trail',
  label: 'Activity Trail',
  icon: History,
}

const shiftsNavItem = {
  to: '/shifts',
  label: 'Shifts',
  icon: Timer,
}

const biometricIdsNavItem = {
  to: '/biometric-ids',
  label: 'Biometric IDs',
  icon: Fingerprint,
}

const ruleBookNavItem = {
  to: '/rule-book',
  label: 'Rule Book & Flow',
  icon: BookOpen,
}

const appointmentLettersNavItem = {
  to: '/admin/appointment-letter-settings',
  label: 'Appointment Letters',
  icon: FileText,
}

function navItemsForRole(role?: string) {
  if (!role) return allNavItems

  const fullAccess = [
    'SUPER_ADMIN',
    'HR_EXECUTIVE',
    'HR_MANAGER',
    'HR_ADMIN_MANAGER',
  ]
  if (fullAccess.includes(role)) {
    const items = allNavItems.filter((item) => item.to !== '/broadcasts')
    const withActivity = [
      ...items,
      ...(role === 'SUPER_ADMIN' ? [activityTrailNavItem, shiftsNavItem] : []),
    ]
    if (role === 'SUPER_ADMIN') {
      return [...withActivity, appointmentLettersNavItem, ...itTeamNavItems]
    }
    if (role === 'HR_MANAGER' || role === 'HR_ADMIN_MANAGER') {
      return [...withActivity, appointmentLettersNavItem]
    }
    return withActivity
  }

  if (role === 'ADMIN_MANAGER' || role === 'ADMIN_OFFICER') {
    const items = allNavItems.filter((item) =>
      ['/dashboard', '/employees', '/attendance', '/leave', '/branch-contacts'].includes(item.to),
    )
    return role === 'ADMIN_MANAGER' ? [...items, appointmentLettersNavItem] : items
  }

  if (role === 'MEDICINE_MANAGER') {
    return allNavItems.filter((item) =>
      ['/dashboard', '/employees', '/attendance', '/branch-contacts'].includes(item.to),
    )
  }

  if (role === 'HR_OPERATIONS_MANAGER') {
    return allNavItems.filter((item) =>
      [
        '/dashboard',
        '/employees',
        '/portal-login',
        '/attendance',
        '/leave',
        '/branch-contacts',
        '/letters',
      ].includes(item.to),
    )
  }

  if (role === 'CHAIRMAN' || role === 'FOUNDER' || role === 'PRESIDENT') {
    return allNavItems.filter((item) =>
      ['/dashboard', '/reports', '/leave'].includes(item.to),
    )
  }

  if (role === 'IT_ADMIN') {
    return [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/employees', label: 'Employees', icon: Users },
      { to: '/attendance', label: 'Attendance', icon: Clock },
      { to: '/branch-contacts', label: 'Branch Contacts', icon: Phone },
      { to: '/payroll', label: 'Payroll', icon: Wallet },
      { to: '/shifts', label: 'Shifts', icon: Timer },
      { to: '/branches', label: 'Branches & Projects', icon: Building2 },
      ...itTeamNavItems,
      { to: '/broadcasts', label: 'Broadcasts', icon: Bell },
      activityTrailNavItem,
    ]
  }

  return allNavItems
}

function useSidebarNavItems() {
  const { user } = useAuth()
  const roleNavItems = navItemsForRole(user?.role)
  const employeeIndex = roleNavItems.findIndex((item) => item.to === '/employees')
  const insertionIndex =
    employeeIndex >= 0
      ? employeeIndex + 1
      : Math.max(1, roleNavItems.findIndex((item) => item.to === '/dashboard') + 1)
  return [
    ...roleNavItems.slice(0, insertionIndex),
    biometricIdsNavItem,
    ...roleNavItems.slice(insertionIndex),
    ruleBookNavItem,
  ]
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const navItems = useSidebarNavItems()
  const emailName = user?.email?.split('@')[0] ?? 'User'

  const handleLogout = () => {
    logout()
    onNavigate?.()
    navigate('/login')
  }

  return (
    <div className="flex h-full flex-col bg-primary text-white">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4 pr-12 sm:px-6 sm:py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-lg font-bold text-primary">
          Y
        </div>
        <div>
          <p className="text-lg font-bold leading-none">YCDO</p>
          <p className="text-xs text-white/70">HRMS</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-white text-primary'
                  : 'text-white/90 hover:bg-primary-light',
              )
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/10 p-4">
        <NavLink
          to="/settings/profile"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'mb-3 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors',
              isActive ? 'bg-white/10' : 'hover:bg-white/5',
            )
          }
        >
          <EmployeeAvatar fullName={emailName} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{emailName}</p>
            <p className="text-xs text-white/60">Settings</p>
          </div>
        </NavLink>
        <div className="mb-3 px-2">
          <p className="truncate text-xs text-white/60">{user?.email}</p>
          <p className="text-xs text-white/50">
            {user?.role ? String(user.role).replace(/_/g, ' ') : ''}
          </p>
        </div>
        <Button
          variant="outline"
          className="w-full border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
          onClick={handleLogout}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Logout
        </Button>
      </div>
    </div>
  )
}

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-[260px] flex-col print:hidden lg:flex">
      <SidebarNav />
    </aside>
  )
}
