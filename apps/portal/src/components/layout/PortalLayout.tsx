import { PortalHeader } from './PortalHeader'
import { PortalNav } from './PortalNav'

export function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface">
      <PortalHeader />
      <div className="pt-[60px] pb-16 md:pb-4">
        <PortalNav />
        <main className="mx-auto max-w-6xl p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
