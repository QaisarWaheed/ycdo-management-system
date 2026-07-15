import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Phone, Search } from 'lucide-react'
import { branchesApi } from '@/api/endpoints/branches'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatBranchTableLabel } from '@/lib/formatBranchLabel'
import { useDebounce } from '@/hooks/useDebounce'
import type { Branch, ProjectType } from '@/types'
import { PROJECT_TYPE_LABELS } from '@/types'

const TAB_CONFIG: { key: string; label: string; type?: ProjectType }[] = [
  { key: 'all', label: 'All Branches' },
  { key: 'HOSPITAL', label: 'Hospitals', type: 'HOSPITAL' },
  { key: 'VTI', label: 'VTIs', type: 'VTI' },
  { key: 'KITCHEN', label: 'Kitchens', type: 'KITCHEN' },
  { key: 'SOFTWARE_HOUSE', label: 'Software House', type: 'SOFTWARE_HOUSE' },
]

function projectTypeBadge(type?: string | null) {
  const styles: Record<string, string> = {
    HOSPITAL: 'bg-blue-100 text-blue-800 border-blue-200',
    VTI: 'bg-purple-100 text-purple-800 border-purple-200',
    KITCHEN: 'bg-amber-100 text-amber-800 border-amber-200',
    SOFTWARE_HOUSE: 'bg-green-100 text-green-800 border-green-200',
  }
  if (!type) return 'bg-gray-100 text-gray-700 border-gray-200'
  return styles[type] ?? 'bg-gray-100 text-gray-700 border-gray-200'
}

function matchesSearch(branch: Branch, query: string): boolean {
  const q = query.toLowerCase()
  return (
    branch.name.toLowerCase().includes(q) ||
    (branch.abbreviation?.toLowerCase().includes(q) ?? false) ||
    (branch.address?.toLowerCase().includes(q) ?? false) ||
    (branch.phone?.toLowerCase().includes(q) ?? false) ||
    (branch.project?.name?.toLowerCase().includes(q) ?? false)
  )
}

function BranchContactsTable({ branches }: { branches: Branch[] }) {
  if (branches.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center text-text-secondary">
        No branches match your search
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Branch</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Contact Number</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {branches.map((branch) => (
            <TableRow key={branch.id}>
              <TableCell>
                <div className="font-medium">{formatBranchTableLabel(branch)}</div>
                {branch.abbreviation && branch.name !== branch.abbreviation && (
                  <div className="text-xs text-text-secondary">{branch.name}</div>
                )}
              </TableCell>
              <TableCell>
                {branch.project?.type ? (
                  <Badge variant="outline" className={projectTypeBadge(branch.project.type)}>
                    {PROJECT_TYPE_LABELS[branch.project.type as ProjectType] ??
                      branch.project.type.replace(/_/g, ' ')}
                  </Badge>
                ) : (
                  '—'
                )}
                {branch.project?.name && (
                  <div className="mt-1 text-xs text-text-secondary">
                    {branch.project.name}
                  </div>
                )}
              </TableCell>
              <TableCell className="max-w-xs text-sm text-text-secondary">
                {branch.address?.trim() || '—'}
              </TableCell>
              <TableCell>
                {branch.phone?.trim() ? (
                  <a
                    href={`tel:${branch.phone.replace(/\s/g, '')}`}
                    className="inline-flex items-center gap-2 font-medium text-blue-600 hover:underline"
                  >
                    <Phone className="h-4 w-4 shrink-0" />
                    {branch.phone}
                  </a>
                ) : (
                  <span className="text-text-secondary">Not listed</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function BranchContactsPage() {
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  const { data: branches = [], isLoading } = useQuery({
    queryKey: ['branches-contacts'],
    queryFn: () => branchesApi.getAll(),
  })

  const filteredByTab = useMemo(() => {
    const config = TAB_CONFIG.find((t) => t.key === tab)
    if (!config?.type) return branches
    return branches.filter((b) => b.project?.type === config.type)
  }, [branches, tab])

  const filtered = useMemo(() => {
    if (!debouncedSearch.trim()) return filteredByTab
    return filteredByTab.filter((b) => matchesSearch(b, debouncedSearch.trim()))
  }, [filteredByTab, debouncedSearch])

  const withPhone = filtered.filter((b) => b.phone?.trim()).length
  const withoutPhone = filtered.length - withPhone

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Branch Contacts</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Contact numbers for all active branches — click a number to call.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-text-secondary">Branches shown</p>
            <p className="text-2xl font-bold">{filtered.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-text-secondary">With contact number</p>
            <p className="text-2xl font-bold text-green-700">{withPhone}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-text-secondary">Missing contact</p>
            <p className="text-2xl font-bold text-amber-700">{withoutPhone}</p>
          </CardContent>
        </Card>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search branch, address, or phone..."
          className="pl-9"
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap gap-1">
          {TAB_CONFIG.map(({ key, label }) => (
            <TabsTrigger key={key} value={key}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TAB_CONFIG.map(({ key }) => (
          <TabsContent key={key} value={key} className="mt-4">
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <BranchContactsTable branches={filtered} />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
