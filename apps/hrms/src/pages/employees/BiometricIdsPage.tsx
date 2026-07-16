import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpDown, Check, Clipboard, Download, Fingerprint, Search } from 'lucide-react'
import {
  employeesApi,
  type BiometricIdReference,
} from '@/api/endpoints/employees'
import { TablePagination } from '@/components/common/TablePagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'

type SortKey =
  | 'biometricId'
  | 'employeeCode'
  | 'fullName'
  | 'currentDesignation'
  | 'currentBranchName'
  | 'status'

const PAGE_SIZE = 25

function csvCell(value: string | null) {
  return `"${(value ?? '').replace(/"/g, '""')}"`
}

export function BiometricIdsPage() {
  const [search, setSearch] = useState('')
  const [branch, setBranch] = useState('ALL')
  const [status, setStatus] = useState('ALL')
  const [sortKey, setSortKey] = useState<SortKey>('biometricId')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const { data: employees = [], isLoading, isError } = useQuery({
    queryKey: ['employees', 'biometric-ids'],
    queryFn: employeesApi.getBiometricIds,
  })

  const branches = useMemo(
    () =>
      [...new Set(employees.map((employee) => employee.currentBranchName).filter(Boolean))]
        .sort() as string[],
    [employees],
  )
  const statuses = useMemo(
    () => [...new Set(employees.map((employee) => employee.status))].sort(),
    [employees],
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return employees
      .filter(
        (employee) =>
          !query ||
          employee.fullName.toLowerCase().includes(query) ||
          employee.employeeCode.toLowerCase().includes(query) ||
          employee.biometricId.toLowerCase().includes(query),
      )
      .filter(
        (employee) =>
          branch === 'ALL' || employee.currentBranchName === branch,
      )
      .filter((employee) => status === 'ALL' || employee.status === status)
      .sort((a, b) => {
        let comparison: number
        if (sortKey === 'biometricId') {
          comparison =
            Number.parseInt(a.biometricId, 10) -
            Number.parseInt(b.biometricId, 10)
        } else {
          comparison = String(a[sortKey] ?? '').localeCompare(
            String(b[sortKey] ?? ''),
            undefined,
            { numeric: true },
          )
        }
        return sortDirection === 'asc' ? comparison : -comparison
      })
  }, [branch, employees, search, sortDirection, sortKey, status])

  useEffect(() => setPage(0), [search, branch, status])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const visibleEmployees = filtered.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  )

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection('asc')
    }
    setPage(0)
  }

  const copyId = async (biometricId: string) => {
    try {
      await navigator.clipboard.writeText(biometricId)
      setCopiedId(biometricId)
      window.setTimeout(() => setCopiedId(null), 1500)
    } catch {
      toast({ title: 'Could not copy biometric ID', variant: 'destructive' })
    }
  }

  const exportCsv = () => {
    const headers = [
      'Biometric ID',
      'Employee Code',
      'Full Name',
      'Designation',
      'Branch',
      'Status',
    ]
    const rows = filtered.map((employee) =>
      [
        employee.biometricId,
        employee.employeeCode,
        employee.fullName,
        employee.currentDesignation,
        employee.currentBranchName,
        employee.status,
      ]
        .map(csvCell)
        .join(','),
    )
    const blob = new Blob([[headers.join(','), ...rows].join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'biometric-id-reference.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const columns: Array<{ key: SortKey; label: string }> = [
    { key: 'biometricId', label: 'Biometric ID' },
    { key: 'employeeCode', label: 'Employee Code' },
    { key: 'fullName', label: 'Full Name' },
    { key: 'currentDesignation', label: 'Designation' },
    { key: 'currentBranchName', label: 'Branch' },
    { key: 'status', label: 'Status' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Fingerprint className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-bold">Biometric ID Reference</h1>
          </div>
          <p className="text-sm text-text-secondary">
            View employee biometric IDs for manual device enrollment
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!filtered.length}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-white p-4 md:grid-cols-[1fr_240px_180px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
          <Input
            className="pl-9"
            placeholder="Search name, employee code, or biometric ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select value={branch} onValueChange={setBranch}>
          <SelectTrigger><SelectValue placeholder="All Branches" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Branches</SelectItem>
            {branches.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            {statuses.map((value) => (
              <SelectItem key={value} value={value}>
                {value.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-white">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column.key}>
                    <button
                      type="button"
                      className="flex items-center gap-1 font-semibold"
                      onClick={() => toggleSort(column.key)}
                    >
                      {column.label}
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(8)].map((_, index) => (
                  <TableRow key={index}>
                    {columns.map((column) => (
                      <TableCell key={column.key}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-red-600">
                    Failed to load biometric IDs
                  </TableCell>
                </TableRow>
              ) : visibleEmployees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-text-secondary">
                    No matching employees found
                  </TableCell>
                </TableRow>
              ) : (
                visibleEmployees.map((employee: BiometricIdReference) => (
                  <TableRow key={employee.employeeCode}>
                    <TableCell>
                      <div className="group flex items-center gap-2">
                        <span className="font-mono text-lg font-bold text-primary">
                          {employee.biometricId}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                          aria-label={`Copy biometric ID ${employee.biometricId}`}
                          onClick={() => copyId(employee.biometricId)}
                        >
                          {copiedId === employee.biometricId ? (
                            <Check className="h-4 w-4 text-green-600" />
                          ) : (
                            <Clipboard className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono">{employee.employeeCode}</TableCell>
                    <TableCell className="font-medium">{employee.fullName}</TableCell>
                    <TableCell>{employee.currentDesignation ?? '—'}</TableCell>
                    <TableCell>{employee.currentBranchName ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{employee.status.replace(/_/g, ' ')}</Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <TablePagination
          page={page}
          totalPages={totalPages}
          total={filtered.length}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      </div>
    </div>
  )
}
