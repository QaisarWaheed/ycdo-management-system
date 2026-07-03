import { Camera } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

interface EmployeeAvatarProps {
  firstName: string
  lastName: string
  photoUrl?: string | null
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
  firstName,
  lastName,
  photoUrl,
  size = 'md',
  className,
  onPhotoClick,
}: EmployeeAvatarProps) {
  const [imgError, setImgError] = useState(false)
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
  const showPhoto = photoUrl && !imgError

  return (
    <div className={cn('relative inline-flex', className)}>
      {showPhoto ? (
        <img
          src={photoUrl}
          alt={`${firstName} ${lastName}`}
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
      {onPhotoClick && (
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
