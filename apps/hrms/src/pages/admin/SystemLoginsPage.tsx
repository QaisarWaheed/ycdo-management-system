import { Monitor } from 'lucide-react'
import { SystemLoginsTab } from '@/components/dashboard/SystemLoginsTab'

export function SystemLoginsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Monitor className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">System Logins</h1>
          <p className="text-sm text-text-secondary">
            Branch admin manager accounts (non-employee system users)
          </p>
        </div>
      </div>
      <SystemLoginsTab />
    </div>
  )
}
