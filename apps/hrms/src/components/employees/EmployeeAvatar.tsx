import { cn } from '@/lib/utils'

interface EmployeeAvatarProps {
  firstName: string
  lastName: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClasses = {
  sm: 'h-10 w-10 text-sm',
  md: 'h-16 w-16 text-xl',
  lg: 'h-24 w-24 text-3xl',
}

export function EmployeeAvatar({
  firstName,
  lastName,
  size = 'md',
  className,
}: EmployeeAvatarProps) {
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()

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
