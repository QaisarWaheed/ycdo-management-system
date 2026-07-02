import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { employeesApi } from '@/api/endpoints/employees'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'
import type { Employee } from '@/types'

interface EmployeeSearchSelectProps {
  value?: string
  onChange: (employeeId: string, employee?: Employee) => void
  label?: string
  placeholder?: string
  className?: string
  excludeIds?: string[]
  employees?: Employee[]
}

export function EmployeeSearchSelect({
  value,
  onChange,
  label = 'Employee',
  placeholder = 'Search by name or code...',
  className,
  excludeIds,
  employees: employeesProp,
}: EmployeeSearchSelectProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [selectedLabel, setSelectedLabel] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const debouncedSearch = useDebounce(search, 400)

  const { data: fetchedEmployees = [], isLoading } = useQuery({
    queryKey: ['employees-search', debouncedSearch],
    queryFn: () =>
      employeesApi.getAll(
        debouncedSearch ? { search: debouncedSearch } : {},
      ),
    enabled: !employeesProp && (open || !!debouncedSearch),
  })

  const employees = employeesProp ?? fetchedEmployees

  const filteredEmployees = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    return employees
      .filter((e) => !excludeIds?.includes(e.id))
      .filter((e) => {
        if (!q) return true
        return (
          e.fullName.toLowerCase().includes(q) ||
          e.employeeCode.toLowerCase().includes(q)
        )
      })
  }, [employees, excludeIds, debouncedSearch])

  useEffect(() => {
    if (value && !selectedLabel) {
      employeesApi.getOne(value).then((emp: Employee) => {
        setSelectedLabel(`${emp.employeeCode} — ${emp.fullName}`)
      }).catch(() => {})
    }
  }, [value, selectedLabel])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSelect = (emp: Employee) => {
    onChange(emp.id, emp)
    setSelectedLabel(`${emp.employeeCode} — ${emp.fullName}`)
    setSearch('')
    setOpen(false)
  }

  return (
    <div ref={containerRef} className={cn('relative space-y-2', className)}>
      {label && <Label>{label}</Label>}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
        <Input
          placeholder={value && selectedLabel ? selectedLabel : placeholder}
          className="pl-9"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setOpen(true)
            if (!e.target.value && value) {
              onChange('')
              setSelectedLabel('')
            }
          }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-white shadow-md">
          {isLoading && !employeesProp ? (
            <div className="p-3">
              <Skeleton className="h-8 w-full" />
            </div>
          ) : filteredEmployees.length === 0 ? (
            <p className="p-3 text-sm text-text-secondary">No employees found</p>
          ) : (
            filteredEmployees.slice(0, 20).map((emp) => (
              <button
                key={emp.id}
                type="button"
                className={cn(
                  'w-full px-3 py-2 text-left text-sm hover:bg-muted',
                  value === emp.id && 'bg-primary/5',
                )}
                onClick={() => handleSelect(emp)}
              >
                <span className="font-mono text-xs text-text-secondary">
                  {emp.employeeCode}
                </span>{' '}
                — {emp.fullName}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
