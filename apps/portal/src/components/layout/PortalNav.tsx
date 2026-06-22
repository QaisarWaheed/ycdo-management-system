import { Link, useLocation } from 'react-router-dom'
import {
  Calendar,
  FileText,
  Home,
  Receipt,
  User,
  Wallet,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/dashboard', label: 'Home', icon: Home },
  { to: '/attendance', label: 'Attendance', icon: Calendar },
  { to: '/leave', label: 'Leave', icon: Wallet },
  { to: '/payroll', label: 'Payroll', icon: Receipt },
  { to: '/letters', label: 'Letters', icon: FileText },
  { to: '/profile', label: 'Profile', icon: User },
]

export function PortalNav() {
  const { pathname } = useLocation()

  return (
    <>
      {/* Desktop horizontal nav */}
      <nav className="hidden border-b border-border bg-white md:block print:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-1 px-4">
          {navItems.map(({ to, label, icon: Icon }) => {
            const active = pathname === to
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-text-secondary hover:border-primary/30 hover:text-text-primary',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-white md:hidden print:hidden">
        <div className="flex items-stretch justify-around">
          {navItems.map(({ to, label, icon: Icon }) => {
            const active = pathname === to
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-text-secondary',
                )}
              >
                <Icon className={cn('h-5 w-5', active && 'text-primary')} />
                {label}
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
