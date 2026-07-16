import { Camera, Venus } from 'lucide-react'
import { useState } from 'react'
import { getEmployeeInitials } from '@/lib/employeeDisplayName'
import { cn } from '@/lib/utils'

interface EmployeeAvatarProps {
  fullName: string
  photoUrl?: string | null
  hideProfilePhoto?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
  onPhotoClick?: () => void
}

const sizeClasses = {
  sm: 'h-10 w-10 text-sm',
  md: 'h-16 w-16 text-xl',
  lg: 'h-24 w-24 text-3xl',
}

export function EmployeeAvatar({
  fullName,
  photoUrl,
  hideProfilePhoto = false,
  size = 'md',
  className,
  onPhotoClick,
}: EmployeeAvatarProps) {
  const [imgError, setImgError] = useState(false)
  const initials = getEmployeeInitials({ fullName })
  const showPhoto = photoUrl && !imgError && !hideProfilePhoto
  const displayName = fullName.trim() || 'Employee'

  return (
    <div className={cn('relative inline-flex', className)}>
      {hideProfilePhoto ? (
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'flex items-center justify-center rounded-full bg-slate-200 text-slate-600',
              sizeClasses[size],
            )}
            aria-label="Female Staff"
          >
            <Venus className={size === 'sm' ? 'h-5 w-5' : 'h-8 w-8'} />
          </div>
          <span className="text-sm font-medium text-slate-600">Female Staff</span>
        </div>
      ) : showPhoto ? (
        <img
          src={photoUrl}
          alt={displayName}
          className={cn(
            'rounded-full object-cover',
            sizeClasses[size],
          )}
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          className={cn(
            'flex items-center justify-center rounded-full bg-primary font-semibold text-white',
            sizeClasses[size],
          )}
        >
          {initials}
        </div>
      )}
      {onPhotoClick && !hideProfilePhoto && (
        <button
          type="button"
          onClick={onPhotoClick}
          className="no-print absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-primary text-white shadow-md hover:bg-primary-dark"
          aria-label="Change photo"
        >
          <Camera className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
