import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Calendar,
  FileText,
  Home,
  MapPin,
  Receipt,
  User,
  Wallet,
} from 'lucide-react'
import { acknowledgementsApi } from '@/api/endpoints/acknowledgements'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/dashboard', label: 'Home', icon: Home },
  { to: '/attendance', label: 'Attendance', icon: Calendar },
  { to: '/leave', label: 'Leave', icon: Wallet },
  { to: '/payroll', label: 'Payroll', icon: Receipt },
  { to: '/outstation', label: 'Outstation', icon: MapPin },
  { to: '/letters', label: 'Letters', icon: FileText, showAckBadge: true },
  { to: '/profile', label: 'Profile', icon: User },
]

export function PortalNav() {
  const { pathname } = useLocation()
  const { user } = useAuth()

  const { data: pendingAcks = [] } = useQuery({
    queryKey: ['pending-acknowledgements'],
    queryFn: () => acknowledgementsApi.getPending(),
    enabled: !!user?.employeeId,
  })

  const pendingAckCount = pendingAcks.length

  return (
    <>
      {/* Desktop horizontal nav */}
      <nav className="hidden border-b border-border bg-white md:block print:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-1 px-4">
          {navItems.map(({ to, label, icon: Icon, showAckBadge }) => {
            const active = pathname === to
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'relative flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-text-secondary hover:border-primary/30 hover:text-text-primary',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
                {showAckBadge && pendingAckCount > 0 && (
                  <Badge className="ml-1 h-5 min-w-5 justify-center bg-red-600 px-1 text-[10px] text-white hover:bg-red-600">
                    {pendingAckCount}
                  </Badge>
                )}
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-white md:hidden print:hidden">
        <div className="flex items-stretch justify-around">
          {navItems.map(({ to, label, icon: Icon, showAckBadge }) => {
            const active = pathname === to
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-text-secondary',
                )}
              >
                <span className="relative">
                  <Icon className={cn('h-5 w-5', active && 'text-primary')} />
                  {showAckBadge && pendingAckCount > 0 && (
                    <Badge className="absolute -right-2 -top-2 h-4 min-w-4 justify-center bg-red-600 px-0.5 text-[9px] text-white hover:bg-red-600">
                      {pendingAckCount}
                    </Badge>
                  )}
                </span>
                {label}
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
