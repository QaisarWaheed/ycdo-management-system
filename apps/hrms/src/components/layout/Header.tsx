import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Bell, LogOut, Menu, User } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { notificationsApi } from '@/api/endpoints/notifications'
import { useAuth } from '@/hooks/useAuth'
import { handleAppBack, shouldShowBackButton } from '@/lib/backNavigation'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface HeaderProps {
  title: string
  onMenuClick?: () => void
}

export function Header({ title, onMenuClick }: HeaderProps) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const fromState =
    typeof location.state === 'object' &&
    location.state !== null &&
    'from' in location.state &&
    typeof (location.state as { from?: string }).from === 'string'
      ? (location.state as { from: string }).from
      : undefined

  const showBack = shouldShowBackButton(location.pathname)

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsApi.getUnreadCount(),
    enabled: !!user?.employeeId,
    retry: false,
  })

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? 'HR'

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-white px-3 sm:h-16 sm:px-4 md:px-6 print:hidden">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {onMenuClick ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 lg:hidden"
            aria-label="Open menu"
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </Button>
        ) : null}
        {showBack && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1 px-2 text-text-secondary hover:text-text-primary sm:px-3"
            onClick={() =>
              handleAppBack(navigate, location.pathname, fromState)
            }
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back</span>
          </Button>
        )}
        <h1 className="truncate text-base font-semibold text-text-primary sm:text-xl">
          {title}
        </h1>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        <button
          type="button"
          className="relative rounded-lg p-2 hover:bg-surface"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5 text-text-secondary" />
          {(unread?.count ?? 0) > 0 && (
            <Badge className="absolute -right-1 -top-1 h-5 min-w-5 justify-center bg-accent px-1 text-[10px] text-white hover:bg-accent">
              {unread?.count}
            </Badge>
          )}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex items-center gap-2 rounded-lg p-1 hover:bg-surface">
              <Avatar className="h-8 w-8 sm:h-9 sm:w-9">
                <AvatarFallback className="bg-primary text-white">{initials}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem disabled>
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem disabled>Change Password</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
