import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { Toaster } from '@/components/ui/toaster'
import { initNativeShell } from '@/lib/native'
import { queryClient } from '@/lib/queryClient'

void initNativeShell()

// Another tab logged in/out: reload so this tab never shows the old user's data.
window.addEventListener('storage', (e) => {
  if (e.key === 'portal_token' || e.key === null) window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
