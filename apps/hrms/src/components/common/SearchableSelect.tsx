import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface SearchableSelectProps {
  options: string[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  allowNew?: boolean
  onNewValue?: (value: string) => void | Promise<void>
  error?: string
  label?: string
  className?: string
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  allowNew = false,
  onNewValue,
  error,
  label,
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectionRef = useRef<number | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.toLowerCase().includes(q))
  }, [options, query])

  const exactMatch = useMemo(() => {
    const q = query.trim().toLowerCase()
    return options.some((o) => o.toLowerCase() === q)
  }, [options, query])

  const showAddNew =
    allowNew && query.trim().length > 0 && !exactMatch && onNewValue

  useEffect(() => {
    setHighlight(0)
  }, [query, open])

  useLayoutEffect(() => {
    const input = inputRef.current
    const pos = selectionRef.current
    if (!input || pos == null || !open) return
    input.setSelectionRange(pos, pos)
    selectionRef.current = null
  }, [query, open])

  const closeDropdown = () => {
    setOpen(false)
    setQuery('')
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

  const selectOption = (opt: string) => {
    onChange(opt)
    closeDropdown()
    inputRef.current?.blur()
  }

  const handleAddNew = async () => {
    const trimmed = query.trim()
    if (!trimmed || !onNewValue) return
    await Promise.resolve(onNewValue(trimmed))
    onChange(trimmed)
    closeDropdown()
    inputRef.current?.blur()
  }

  const handleFocus = () => {
    if (disabled) return
    setQuery(value)
    setOpen(true)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setQuery(value)
        setOpen(true)
      }
      return
    }

    const totalItems = filtered.length + (showAddNew ? 1 : 0)

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => (h + 1) % Math.max(totalItems, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(
        (h) =>
          (h - 1 + Math.max(totalItems, 1)) % Math.max(totalItems, 1),
      )
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (showAddNew && highlight === filtered.length) {
        void handleAddNew()
      } else if (filtered[highlight]) {
        selectOption(filtered[highlight])
      } else if (showAddNew) {
        void handleAddNew()
      }
    } else if (e.key === 'Escape') {
      closeDropdown()
      inputRef.current?.blur()
    }
  }

  return (
    <div ref={containerRef} className={cn('relative space-y-2', className)}>
      {label && (
        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          {label}
        </label>
      )}
      <Input
        ref={inputRef}
        type="text"
        autoComplete="off"
        value={open ? query : value}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(error && 'border-destructive')}
        onChange={(e) => {
          selectionRef.current = e.target.selectionStart
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
      />
      {open && !disabled && (
        <div className="absolute z-50 mt-1 max-h-[200px] w-full overflow-y-auto rounded-md border border-border bg-white shadow-md">
          {filtered.length === 0 && !showAddNew && (
            <p className="px-3 py-2 text-sm text-text-secondary">No matches</p>
          )}
          {filtered.map((opt, i) => (
            <div
              key={opt}
              className={cn(
                'cursor-pointer px-3 py-2 text-sm hover:bg-gray-50',
                value === opt && 'font-medium text-primary',
                highlight === i && 'bg-gray-50',
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectOption(opt)}
            >
              {opt}
            </div>
          ))}
          {showAddNew && (
            <div
              className={cn(
                'flex cursor-pointer items-center gap-1 px-3 py-2 text-sm text-green-700 hover:bg-gray-50',
                highlight === filtered.length && 'bg-gray-50',
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void handleAddNew()}
            >
              <Plus className="h-3.5 w-3.5" />
              Add &quot;{query.trim()}&quot; (press Enter)
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
    </div>
  )
}
