import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Calendar,
  FileText,
  Home,
  MapPin,
  MoreHorizontal,
  Palmtree,
  Receipt,
  User,
  UserCheck,
  Wallet,
} from 'lucide-react'
import { acknowledgementsApi } from '@/api/endpoints/acknowledgements'
import { employeeOnboardingApi } from '@/api/endpoints/employeeOnboarding'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useAuth } from '@/hooks/useAuth'
import { isPortalEmployeeUser, isPortalExecutiveUser } from '@/lib/portalRoles'
import { cn } from '@/lib/utils'

type NavItem = {
  to: string
  label: string
  icon: React.ElementType
  showAckBadge?: boolean
  showPendingBadge?: boolean
}

const employeePrimary: NavItem[] = [
  { to: '/dashboard', label: 'Home', icon: Home },
  { to: '/attendance', label: 'Attendance', icon: Calendar },
  { to: '/leave', label: 'Leave', icon: Palmtree },
  { to: '/letters', label: 'Letters', icon: FileText, showAckBadge: true },
]

const employeeMore: NavItem[] = [
  { to: '/payroll', label: 'Payroll', icon: Receipt },
  { to: '/advance-loan', label: 'Advance & Loan', icon: Wallet },
  { to: '/branch-change-request', label: 'Station / Branch Change', icon: MapPin },
  { to: '/profile', label: 'Profile', icon: User },
]

const executiveNav: NavItem[] = [
  { to: '/dashboard', label: 'Home', icon: Home, showPendingBadge: true },
  { to: '/dashboard', label: 'Approvals', icon: UserCheck, showPendingBadge: true },
]

function NavLinkItem({
  item,
  active,
  pendingAckCount,
  pendingOnboarding,
  compact,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  pendingAckCount: number
  pendingOnboarding: number
  compact?: boolean
  onNavigate?: () => void
}) {
  const Icon = item.icon
  const badge =
    (item.showAckBadge && pendingAckCount > 0 && pendingAckCount) ||
    (item.showPendingBadge && pendingOnboarding > 0 && pendingOnboarding) ||
    0

  if (compact) {
    return (
      <Link
        to={item.to}
        onClick={onNavigate}
        className={cn(
          'relative flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-medium transition-colors',
          active ? 'text-primary' : 'text-text-secondary',
        )}
      >
        <span className="relative">
          <Icon className={cn('h-5 w-5', active && 'text-primary')} />
          {badge > 0 && (
            <Badge className="absolute -right-2 -top-2 h-4 min-w-4 justify-center bg-red-600 px-0.5 text-[9px] text-white hover:bg-red-600">
              {badge}
            </Badge>
          )}
        </span>
        <span className="max-w-full truncate">{item.label}</span>
      </Link>
    )
  }

  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      className={cn(
        'relative flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-text-secondary hover:border-primary/30 hover:text-text-primary',
      )}
    >
      <Icon className="h-4 w-4" />
      {item.label}
      {badge > 0 && (
        <Badge className="ml-1 h-5 min-w-5 justify-center bg-red-600 px-1 text-[10px] text-white hover:bg-red-600">
          {badge}
        </Badge>
      )}
    </Link>
  )
}

export function PortalNav() {
  const { pathname } = useLocation()
  const { user } = useAuth()
  const [moreOpen, setMoreOpen] = useState(false)
  const isExecutive = isPortalExecutiveUser(user)
  const isEmployee = isPortalEmployeeUser(user)

  const desktopItems: NavItem[] = isExecutive && !isEmployee
    ? [{ to: '/dashboard', label: 'Approvals', icon: UserCheck, showPendingBadge: true }]
    : isExecutive && isEmployee
      ? [
          { to: '/dashboard', label: 'Home', icon: Home, showPendingBadge: true },
          ...employeePrimary.filter((i) => i.to !== '/dashboard'),
          ...employeeMore,
        ]
      : [...employeePrimary, ...employeeMore]

  const mobilePrimary: NavItem[] =
    isExecutive && !isEmployee
      ? executiveNav.slice(0, 1)
      : employeePrimary

  const mobileMore: NavItem[] =
    isExecutive && !isEmployee
      ? []
      : employeeMore

  const { data: pendingAcks = [] } = useQuery({
    queryKey: ['pending-acknowledgements'],
    queryFn: () => acknowledgementsApi.getPending(),
    enabled: !!user?.employeeId,
  })

  const { data: pendingOnboarding = [] } = useQuery({
    queryKey: ['employee-onboarding', 'pending'],
    queryFn: () => employeeOnboardingApi.getPending(),
    enabled: isExecutive,
  })

  const pendingAckCount = pendingAcks.length
  const pendingOnboardingCount = pendingOnboarding.length
  const moreActive = mobileMore.some((i) => pathname === i.to)

  return (
    <>
      {/* Desktop / large tablet horizontal nav */}
      <nav className="hidden border-b border-border bg-white lg:block print:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4">
          {desktopItems.map((item) => (
            <NavLinkItem
              key={`${item.to}-${item.label}`}
              item={item}
              active={pathname === item.to}
              pendingAckCount={pendingAckCount}
              pendingOnboarding={pendingOnboardingCount}
            />
          ))}
        </div>
      </nav>

      {/* Mobile / tablet bottom nav — max 5 slots */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-white pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden"
      >
        <div className="flex items-stretch justify-around">
          {mobilePrimary.map((item) => (
            <NavLinkItem
              key={`${item.to}-${item.label}`}
              item={item}
              active={pathname === item.to}
              pendingAckCount={pendingAckCount}
              pendingOnboarding={pendingOnboardingCount}
              compact
            />
          ))}
          {mobileMore.length > 0 && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={cn(
                'relative flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-medium',
                moreActive ? 'text-primary' : 'text-text-secondary',
              )}
            >
              <MoreHorizontal className="h-5 w-5" />
              More
            </button>
          )}
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-8">
          <SheetHeader className="text-left">
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {mobileMore.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border border-border p-4 text-sm font-medium',
                  pathname === to
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'text-text-primary',
                )}
              >
                <Icon className="h-6 w-6" />
                {label}
              </Link>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
