import { PortalHeader } from './PortalHeader'
import { PortalNav } from './PortalNav'

export function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-surface">
      <PortalHeader />
      <div className="pb-[calc(4.25rem+env(safe-area-inset-bottom))] pt-[60px] lg:pb-4">
        <PortalNav />
        <main className="mx-auto max-w-6xl px-3 py-4 sm:p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
