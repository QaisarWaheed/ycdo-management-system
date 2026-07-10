import { Button } from '@/components/ui/button'
import { PAGE_SIZE } from '@/constants/pagination'

type TablePaginationProps = {
  page: number
  totalPages: number
  total: number
  pageSize?: number
  onPageChange: (page: number) => void
}

export function TablePagination({
  page,
  totalPages,
  total,
  pageSize = PAGE_SIZE,
  onPageChange,
}: TablePaginationProps) {
  if (total <= pageSize) {
    return null
  }

  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3">
      <p className="text-sm text-text-secondary">
        Page {page + 1} of {totalPages}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
