import { useQuery } from '@tanstack/react-query'
import { Bell, LogOut, User } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { notificationsApi } from '@/api/endpoints/notifications'
import { useAuth } from '@/hooks/useAuth'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
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
      <h1 className="text-xl font-semibold text-text-primary">{title}</h1>

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
