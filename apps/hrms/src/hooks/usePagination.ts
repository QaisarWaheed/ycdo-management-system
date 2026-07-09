import { useEffect, useMemo, useState } from 'react'
import { PAGE_SIZE } from '@/constants/pagination'

export function usePagination<T>(items: T[], resetDeps: unknown[] = []) {
  const [page, setPage] = useState(0)

  useEffect(() => {
    setPage(0)
  }, resetDeps)

  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const paginated = useMemo(
    () => items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [items, page],
  )

  return {
    page,
    setPage,
    totalPages,
    paginated,
    total,
    pageSize: PAGE_SIZE,
  }
}
