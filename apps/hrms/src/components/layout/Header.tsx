import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Bell, LogOut, User } from 'lucide-react'
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
}

export function Header({ title }: HeaderProps) {
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
    <header className="flex h-16 items-center justify-between border-b border-border bg-white px-6 print:hidden">
      <div className="flex min-w-0 items-center gap-3">
        {showBack && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1 text-text-secondary hover:text-text-primary"
            onClick={() =>
              handleAppBack(navigate, location.pathname, fromState)
            }
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        )}
        <h1 className="truncate text-xl font-semibold text-text-primary">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-4">
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
              <Avatar className="h-9 w-9">
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
