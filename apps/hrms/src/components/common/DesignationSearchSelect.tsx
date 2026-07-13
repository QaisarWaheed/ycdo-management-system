import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { designationsApi } from '@/api/endpoints/designations'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
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
  /** @deprecated Use `departments` — filters by stored department name */
  departments?: string[]
  disabled?: boolean
  helperText?: string
}

export function DesignationSearchSelect({
  value,
  onChange,
  label = 'Designation *',
  error,
  className,
  categories,
  departments,
  disabled = false,
  helperText,
}: DesignationSearchSelectProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectionRef = useRef<number | null>(null)

  const departmentFilter = departments ?? categories

  const designationParams = useMemo(() => {
    if (!departmentFilter?.length) return undefined
    return { categories: departmentFilter.join(',') }
  }, [departmentFilter])

  const { data: designations = [], isLoading } = useQuery({
    queryKey: ['designations', designationParams],
    queryFn: () => designationsApi.getAll(designationParams),
  })

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
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
  }, [designations, search])

  const closeDropdown = () => {
    setOpen(false)
    setSearch('')
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        closeDropdown()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useLayoutEffect(() => {
    const input = inputRef.current
    const pos = selectionRef.current
    if (!input || pos == null || !open) return
    input.setSelectionRange(pos, pos)
    selectionRef.current = null
  }, [search, open])

  const handleFocus = () => {
    if (disabled) return
    setSearch(value ?? '')
    setOpen(true)
  }

  return (
    <div ref={containerRef} className={cn('relative space-y-2', className)}>
      {label && <Label>{label}</Label>}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
        <Input
          ref={inputRef}
          type="text"
          autoComplete="off"
          placeholder={
            disabled ? 'Select department first' : value || 'Search designation...'
          }
          className={cn('pl-9', error && 'border-destructive')}
          value={open ? search : (value ?? '')}
          disabled={disabled}
          onChange={(e) => {
            selectionRef.current = e.target.selectionStart
            setSearch(e.target.value)
            setOpen(true)
          }}
          onFocus={handleFocus}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              closeDropdown()
              inputRef.current?.blur()
            }
          }}
        />
      </div>
      {helperText && (
        <p className="text-xs text-text-secondary">{helperText}</p>
      )}
      {open && !disabled && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-white shadow-lg">
          {isLoading ? (
            <div className="p-3">
              <Skeleton className="h-8 w-full" />
            </div>
          ) : grouped.length === 0 ? (
            <p className="p-3 text-sm text-text-secondary">No designations found</p>
          ) : (
            grouped.map(([departmentName, items]) => (
              <div key={departmentName}>
                <p className="sticky top-0 bg-muted px-3 py-1.5 text-xs font-semibold uppercase text-text-secondary">
                  {departmentName}
                </p>
                {items.map((d) => (
                  <div
                    key={d.id}
                    className={cn(
                      'cursor-pointer px-3 py-2 text-sm hover:bg-surface',
                      value === d.title && 'bg-primary/10 font-medium',
                    )}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onChange(d.title)
                      closeDropdown()
                      inputRef.current?.blur()
                    }}
                  >
                    {d.title}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
