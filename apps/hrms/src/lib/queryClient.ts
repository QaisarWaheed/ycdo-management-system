import { QueryClient } from '@tanstack/react-query'

// Shared instance so the auth store can clear cached data on login/logout.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

for (const key of ['departments', 'designations']) {
  queryClient.setQueryDefaults([key], { staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always' })
}
