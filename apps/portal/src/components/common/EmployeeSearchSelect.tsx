import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { leaveApi } from '@/api/endpoints/leave'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'

export interface RelieverCandidate {
  id: string
  employeeCode: string
  firstName: string
  lastName: string
  shift?: {
    id: string
    name: string
    startTime: string
    endTime: string
  } | null
}

interface EmployeeSearchSelectProps {
  value?: string
  onChange: (employeeId: string, employee?: RelieverCandidate) => void
  label?: string
  placeholder?: string
  className?: string
  excludeId?: string
}

export function EmployeeSearchSelect({
  value,
  onChange,
  label = 'Employee',
  placeholder = 'Search by name or code...',
  className,
  excludeId,
}: EmployeeSearchSelectProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [selectedLabel, setSelectedLabel] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const debouncedSearch = useDebounce(search, 400)

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['reliever-candidates', debouncedSearch],
    queryFn: () => leaveApi.getRelieverCandidates(debouncedSearch || undefined),
    enabled: open || !!debouncedSearch,
  })

  const filtered = excludeId
    ? (employees as RelieverCandidate[]).filter((e) => e.id !== excludeId)
    : (employees as RelieverCandidate[])

  useEffect(() => {
    if (value && !selectedLabel) {
      leaveApi.getRelieverCandidates().then((list: RelieverCandidate[]) => {
        const emp = list.find((e) => e.id === value)
        if (emp) {
          setSelectedLabel(
            `${emp.employeeCode} — ${emp.firstName} ${emp.lastName}`,
          )
        }
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

  const handleSelect = (emp: RelieverCandidate) => {
    onChange(emp.id, emp)
    setSelectedLabel(`${emp.employeeCode} — ${emp.firstName} ${emp.lastName}`)
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
          ) : filtered.length === 0 ? (
            <p className="p-3 text-sm text-text-secondary">No employees found</p>
          ) : (
            filtered.map((emp) => (
              <button
                key={emp.id}
                type="button"
                className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-surface"
                onClick={() => handleSelect(emp)}
              >
                <span className="font-medium">
                  {emp.employeeCode} — {emp.firstName} {emp.lastName}
                </span>
                {emp.shift && (
                  <span className="text-xs text-text-secondary">
                    Shift: {emp.shift.startTime} to {emp.shift.endTime}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
