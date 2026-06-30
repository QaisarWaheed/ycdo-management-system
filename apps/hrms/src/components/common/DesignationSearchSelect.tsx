import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { designationsApi } from '@/api/endpoints/designations'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'

export interface Designation {
  id: string
  title: string
  category: string
}

interface DesignationSearchSelectProps {
  value?: string
  onChange: (title: string) => void
  label?: string
  error?: boolean
  className?: string
  categories?: string[]
}

export function DesignationSearchSelect({
  value,
  onChange,
  label = 'Designation *',
  error,
  className,
  categories,
}: DesignationSearchSelectProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debouncedSearch = useDebounce(search, 300)

  const designationParams = useMemo(() => {
    if (!categories?.length) return undefined
    return { categories: categories.join(',') }
  }, [categories])

  const { data: designations = [], isLoading } = useQuery({
    queryKey: ['designations', designationParams],
    queryFn: () => designationsApi.getAll(designationParams),
  })

  const grouped = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    const filtered = (designations as Designation[]).filter(
      (d) =>
        !q ||
        d.title.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q),
    )
    const map = new Map<string, Designation[]>()
    for (const d of filtered) {
      const list = map.get(d.category) ?? []
      list.push(d)
      map.set(d.category, list)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [designations, debouncedSearch])

  return (
    <div ref={containerRef} className={cn('relative space-y-2', className)}>
      {label && <Label>{label}</Label>}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
        <Input
          placeholder={value || 'Search designation...'}
          className={cn('pl-9', error && 'border-destructive')}
          value={open ? search : value || search}
          onChange={(e) => {
            setSearch(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-white shadow-lg">
          {isLoading ? (
            <div className="p-3">
              <Skeleton className="h-8 w-full" />
            </div>
          ) : grouped.length === 0 ? (
            <p className="p-3 text-sm text-text-secondary">No designations found</p>
          ) : (
            grouped.map(([category, items]) => (
              <div key={category}>
                <p className="sticky top-0 bg-muted px-3 py-1.5 text-xs font-semibold uppercase text-text-secondary">
                  {category}
                </p>
                {items.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={cn(
                      'block w-full px-3 py-2 text-left text-sm hover:bg-surface',
                      value === d.title && 'bg-primary/10 font-medium',
                    )}
                    onClick={() => {
                      onChange(d.title)
                      setSearch('')
                      setOpen(false)
                    }}
                  >
                    {d.title}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
