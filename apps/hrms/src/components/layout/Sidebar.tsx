import { NavLink, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  Calendar,
  Clock,
  FileText,
  LayoutDashboard,
  LogOut,
  MapPin,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmployeeAvatar } from '@/components/employees/EmployeeAvatar'

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/employees', label: 'Employees', icon: Users },
  { to: '/attendance', label: 'Attendance', icon: Clock },
  { to: '/outstation', label: 'Outstation', icon: MapPin },
  { to: '/leave', label: 'Leave', icon: Calendar },
  { to: '/payroll', label: 'Payroll', icon: Wallet },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/letters', label: 'Letters', icon: FileText },
  { to: '/disciplinary', label: 'Disciplinary', icon: AlertTriangle },
  { to: '/recruitment', label: 'Recruitment', icon: UserPlus },
  { to: '/broadcasts', label: 'Broadcasts', icon: Bell },
  { to: '/branches', label: 'Branches & Projects', icon: Building2 },
]

export function Sidebar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const emailName = user?.email?.split('@')[0] ?? 'User'

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-[260px] flex-col bg-primary text-white print:hidden">
      <div className="flex items-center gap-3 border-b border-white/10 px-6 py-5">
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
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-white text-primary'
                  : 'text-white/90 hover:bg-primary-light',
              )
            }
          >
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/10 p-4">
        <NavLink
          to="/settings/profile"
          className={({ isActive }) =>
            cn(
              'mb-3 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors',
              isActive ? 'bg-white/10' : 'hover:bg-white/5',
            )
          }
        >
          <EmployeeAvatar
            firstName={emailName.charAt(0)}
            lastName={emailName.charAt(1) ?? ''}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{emailName}</p>
            <p className="text-xs text-white/60">Settings</p>
          </div>
        </NavLink>
        <div className="mb-3 px-2">
          <p className="truncate text-xs text-white/60">{user?.email}</p>
          <p className="text-xs text-white/50">
            {user?.role?.replace(/_/g, ' ')}
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
    </aside>
  )
}
