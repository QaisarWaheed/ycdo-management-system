import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, FileText, LogOut } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { acknowledgementsApi } from '@/api/endpoints/acknowledgements'
import { notificationsApi } from '@/api/endpoints/notifications'
import { employeesApi } from '@/api/endpoints/employees'
import { useAuth } from '@/hooks/useAuth'
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
import { cn } from '@/lib/utils'
import type { Notification } from '@/types'

export function PortalHeader() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: employee } = useQuery({
    queryKey: ['employee-header', user?.employeeId],
    queryFn: () => employeesApi.getOne(user!.employeeId!),
    enabled: !!user?.employeeId,
  })

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.getMy(),
    enabled: !!user?.employeeId,
  })

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsApi.getUnreadCount(),
    enabled: !!user?.employeeId,
  })

  const { data: pendingAcks = [] } = useQuery({
    queryKey: ['pending-acknowledgements'],
    queryFn: () => acknowledgementsApi.getPending(),
    enabled: !!user?.employeeId,
  })

  const pendingAckCount = pendingAcks.length

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const displayName = employee
    ? employee.fullName
    : user?.email ?? 'Employee'

  const initials = employee
    ? employee.fullName
        .trim()
        .split(/\s+/)
        .map((part: string) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : user?.email?.slice(0, 2).toUpperCase() ?? 'EP'

  const recentNotifications = (notifications as Notification[]).slice(0, 10)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.isRead) {
      markReadMutation.mutate(notification.id)
    }
  }

  return (
    <header className="fixed left-0 right-0 top-0 z-50 flex h-[60px] items-center justify-between border-b border-border bg-white px-4 print:hidden">
      <Link to="/dashboard" className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
          Y
        </div>
        <div className="hidden sm:block">
          <p className="text-sm font-bold text-primary">YCDO</p>
          <p className="text-[10px] text-text-secondary">Employee Portal</p>
        </div>
      </Link>

      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="relative" asChild>
          <Link to="/letters" aria-label="My Letters">
            <FileText className="h-5 w-5 text-text-secondary" />
            {pendingAckCount > 0 && (
              <Badge className="absolute -right-1 -top-1 h-5 min-w-5 justify-center bg-red-600 px-1 text-[10px] text-white hover:bg-red-600">
                {pendingAckCount}
              </Badge>
            )}
          </Link>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5 text-text-secondary" />
              {(unread?.count ?? 0) > 0 && (
                <Badge className="absolute -right-1 -top-1 h-5 min-w-5 justify-center bg-accent px-1 text-[10px] text-white hover:bg-accent">
                  {unread?.count}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-sm font-semibold">Notifications</span>
              {(unread?.count ?? 0) > 0 && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => markAllReadMutation.mutate()}
                  disabled={markAllReadMutation.isPending}
                >
                  Mark all read
                </button>
              )}
            </div>
            <DropdownMenuSeparator />
            {recentNotifications.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-text-secondary">
                No notifications
              </p>
            ) : (
              recentNotifications.map((n) => (
                <DropdownMenuItem
                  key={n.id}
                  className="cursor-pointer flex-col items-start gap-1 py-2"
                  onClick={() => handleNotificationClick(n)}
                >
                  <div className="flex w-full items-start justify-between gap-2">
                    <p
                      className={cn(
                        'text-sm leading-snug',
                        !n.isRead && 'font-semibold',
                      )}
                    >
                      {n.message}
                    </p>
                    {!n.isRead && (
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
                    )}
                  </div>
                  <span className="text-xs text-text-secondary">
                    {formatDistanceToNow(new Date(n.createdAt), {
                      addSuffix: true,
                    })}
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg p-1 hover:bg-surface"
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-xs text-white">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden max-w-[120px] truncate text-sm font-medium sm:inline">
                {displayName}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem asChild>
              <Link to="/profile">My Profile</Link>
            </DropdownMenuItem>
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
