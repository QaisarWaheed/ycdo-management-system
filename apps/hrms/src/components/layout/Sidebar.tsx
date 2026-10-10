import { useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart3,
  Bell,
  BookOpen,
  BadgeCheck,
  Briefcase,
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
import { authApi } from '@/api/endpoints/auth'
import { useAuthStore } from '@/store/auth.store'
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
  { to: '/careers', label: 'Careers Portal', icon: Briefcase },
  { to: '/broadcasts', label: 'Broadcasts', icon: Bell },
  { to: '/branches', label: 'Branches & Projects', icon: Building2 },
]

const itTeamNavItems = [
  { to: '/admin/master-data', label: 'Master Data', icon: Database },
  { to: '/admin/roles', label: 'Roles & Access', icon: ShieldCheck },
  { to: '/admin/login-access', label: 'Login Access', icon: Shield },
  { to: '/admin/pending-approvals', label: 'Pending Approvals', icon: UserPlus },
  { to: '/admin/letter-templates', label: 'Letter Templates', icon: FileText },
]

const payApprovalsNavItem = {
  to: '/pay-approvals',
  label: 'Pay Approvals',
  icon: BadgeCheck,
}

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
      payApprovalsNavItem,
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
    return [
      ...allNavItems.filter((item) =>
        ['/dashboard', '/employees', '/payroll', '/incentives', '/reports', '/leave'].includes(
          item.to,
        ),
      ),
      payApprovalsNavItem,
    ]
  }

  if (role === 'PAYROLL_OFFICER') {
    return [
      ...allNavItems.filter((item) =>
        ['/dashboard', '/employees', '/attendance', '/payroll', '/incentives', '/letters', '/reports'].includes(
          item.to,
        ),
      ),
      payApprovalsNavItem,
    ]
  }

  if (role === 'PROGRESS_OFFICER') {
    return allNavItems.filter((item) =>
      ['/dashboard', '/employees', '/letters', '/reports'].includes(item.to),
    )
  }

  if (role === 'IT_ADMIN') {
    return [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/employees', label: 'Employees', icon: Users },
      { to: '/attendance', label: 'Attendance', icon: Clock },
      { to: '/branch-contacts', label: 'Branch Contacts', icon: Phone },
      { to: '/payroll', label: 'Payroll', icon: Wallet },
      payApprovalsNavItem,
      { to: '/shifts', label: 'Shifts', icon: Timer },
      { to: '/branches', label: 'Branches & Projects', icon: Building2 },
      ...itTeamNavItems,
      { to: '/broadcasts', label: 'Broadcasts', icon: Bell },
      activityTrailNavItem,
    ]
  }

  return allNavItems
}

/**
 * What each section needs on the server. `permission` sections follow Login
 * Access (IT Grant/Deny); `roles` mirror the @Roles on the page's main API
 * read, so the menu never offers a page that would come back empty or denied.
 * Sections not listed here are open to every HRMS login.
 */
const SECTION_ACCESS: Record<string, { permission?: string; roles?: string[] }> = {
  '/employees': { permission: 'EMPLOYEES_VIEW' },
  '/payroll': { permission: 'PAYROLL_VIEW' },
  '/incentives': { permission: 'INCENTIVES_VIEW' },
  '/reports': { permission: 'REPORTS_VIEW' },
  '/letters': { permission: 'LETTERS_GENERATE' },
  '/portal-login': {
    roles: ['HR_MANAGER', 'HR_ADMIN_MANAGER', 'HR_EXECUTIVE', 'HR_OPERATIONS_MANAGER'],
  },
  '/attendance': {
    roles: [
      'PAYROLL_OFFICER',
      'HR_MANAGER',
      'HR_ADMIN_MANAGER',
      'HR_OPERATIONS_MANAGER',
      'HR_EXECUTIVE',
      'ADMIN_MANAGER',
      'ADMIN_OFFICER',
      'MEDICINE_MANAGER',
      'IT_ADMIN',
      'CHAIRMAN',
      'FOUNDER',
      'PRESIDENT',
    ],
  },
  '/branch-change-request': {
    roles: [
      'HR_MANAGER',
      'HR_ADMIN_MANAGER',
      'HR_OPERATIONS_MANAGER',
      'HR_EXECUTIVE',
      'ADMIN_MANAGER',
      'ADMIN_OFFICER',
      'CHAIRMAN',
      'FOUNDER',
      'PRESIDENT',
    ],
  },
  '/leave': {
    roles: [
      'HR_MANAGER',
      'HR_ADMIN_MANAGER',
      'HR_OPERATIONS_MANAGER',
      'HR_EXECUTIVE',
      'ADMIN_MANAGER',
      'ADMIN_OFFICER',
      'IT_ADMIN',
      'CHAIRMAN',
      'FOUNDER',
      'PRESIDENT',
    ],
  },
  '/recruitment': { roles: ['HR_MANAGER', 'HR_EXECUTIVE', 'ADMIN_MANAGER'] },
  '/careers': { roles: ['HR_MANAGER', 'HR_ADMIN_MANAGER', 'HR_EXECUTIVE', 'ADMIN_MANAGER', 'IT_ADMIN', 'SUPER_ADMIN'] },
  '/broadcasts': { roles: ['IT_ADMIN', 'HR_EXECUTIVE'] },
  // The Activity Trail page only renders its data for Super Admin.
  '/activity-trail': { roles: [] },
  '/admin/master-data': { roles: ['IT_ADMIN'] },
  '/admin/roles': { roles: ['IT_ADMIN'] },
  '/admin/login-access': { roles: ['IT_ADMIN'] },
  '/admin/pending-approvals': { roles: ['IT_ADMIN', 'SUPER_ADMIN'] },
  '/pay-approvals': {
    roles: [
      'PRESIDENT',
      'FOUNDER',
      'CHAIRMAN',
      'SUPER_ADMIN',
      'IT_ADMIN',
      'PAYROLL_OFFICER',
      'HR_MANAGER',
      'HR_ADMIN_MANAGER',
      'HR_OPERATIONS_MANAGER',
      'HR_EXECUTIVE',
    ],
  },
  '/admin/letter-templates': {
    roles: ['HR_MANAGER', 'HR_ADMIN_MANAGER', 'HR_EXECUTIVE', 'ADMIN_MANAGER', 'ADMIN_OFFICER', 'IT_ADMIN'],
  },
  '/admin/appointment-letter-settings': {
    roles: ['HR_MANAGER', 'HR_ADMIN_MANAGER', 'HR_EXECUTIVE', 'ADMIN_MANAGER'],
  },
}

/** Roles whose menu is exactly their curated list (no Biometric IDs / Rule Book). */
const FIXED_MENU_ROLES = ['PAYROLL_OFFICER', 'PROGRESS_OFFICER']

function useSidebarNavItems() {
  const { user, hasRole, hasPermission } = useAuth()
  const overrides = user?.permissionOverrides ?? {}
  const isSuperAdmin = hasRole(['SUPER_ADMIN'])

  const canOpen = (to: string) => {
    if (isSuperAdmin) return true
    const access = SECTION_ACCESS[to]
    if (!access) return true
    if (access.permission) {
      if (overrides[access.permission] === false) return false
      return hasPermission(access.permission)
    }
    return access.roles ? hasRole(access.roles) : true
  }

  const roleNavItems = navItemsForRole(user?.role)
  let items = roleNavItems
  if (!FIXED_MENU_ROLES.includes(user?.role ?? '')) {
    const employeeIndex = items.findIndex((item) => item.to === '/employees')
    const insertionIndex =
      employeeIndex >= 0
        ? employeeIndex + 1
        : Math.max(1, items.findIndex((item) => item.to === '/dashboard') + 1)
    items = [
      ...items.slice(0, insertionIndex),
      biometricIdsNavItem,
      ...items.slice(insertionIndex),
      ruleBookNavItem,
    ]
  }

  // IT "Grant" on a section permission adds that section even when the role's
  // menu leaves it out.
  const granted = allNavItems.filter((item) => {
    const permission = SECTION_ACCESS[item.to]?.permission
    return (
      !!permission &&
      overrides[permission] === true &&
      !items.some((existing) => existing.to === item.to)
    )
  })
  if (granted.length) {
    const order = allNavItems.map((item) => item.to)
    const rank = (to: string) => {
      const index = order.indexOf(to)
      return index === -1 ? order.length : index
    }
    items = [...items, ...granted].sort((a, b) => rank(a.to) - rank(b.to))
  }

  return items.filter((item) => canOpen(item.to))
}

function useRefreshCurrentUser() {
  const { isAuthenticated } = useAuth()
  const updateUser = useAuthStore((state) => state.updateUser)
  const { data } = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => authApi.me(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  })
  useEffect(() => {
    if (data) updateUser(data)
  }, [data, updateUser])
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  useRefreshCurrentUser()
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
