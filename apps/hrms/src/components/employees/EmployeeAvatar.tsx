import { cn } from '@/lib/utils'

interface EmployeeAvatarProps {
  fullName: string
  photoUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClasses = {
  sm: 'h-10 w-10 text-sm',
  md: 'h-16 w-16 text-xl',
  lg: 'h-24 w-24 text-3xl',
}

function getInitials(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase()
}

export function EmployeeAvatar({
  fullName,
  photoUrl,
  size = 'md',
  className,
}: EmployeeAvatarProps) {
  const initials = getInitials(fullName)

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={fullName}
        className={cn(
          'rounded-full object-cover',
          sizeClasses[size],
          className,
        )}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full bg-primary font-semibold text-white',
        sizeClasses[size],
        className,
      )}
    >
      {initials}
    </div>
  )
}
