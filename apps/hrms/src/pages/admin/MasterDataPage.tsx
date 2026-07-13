import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { locationValuesApi, type LocationValue } from '@/api/endpoints/locationValues'
import { TablePagination } from '@/components/common/TablePagination'
import { TableRecordCount } from '@/components/common/TableRecordCount'
import { SearchableSelect } from '@/components/common/SearchableSelect'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { useAuth } from '@/hooks/useAuth'
import { usePagination } from '@/hooks/usePagination'
import { LOCATION_VALUE_TYPES } from '@/lib/locationValueTypes'
import { pakistanProvinces } from '@/lib/pakistanData'

function typeMeta(type: string) {
  return LOCATION_VALUE_TYPES.find((item) => item.value === type)
}

function ValueFormFields({
  type,
  value,
  province,
  city,
  onValueChange,
  onProvinceChange,
  onCityChange,
}: {
  type: string
  value: string
  province: string
  city: string
  onValueChange: (v: string) => void
  onProvinceChange: (v: string) => void
  onCityChange: (v: string) => void
}) {
  const meta = typeMeta(type)

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Name *</Label>
        <Input
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={`Enter ${meta?.label.toLowerCase() ?? 'value'}`}
        />
      </div>
      {meta?.parentLabel === 'Province' && (
        <SearchableSelect
          label="Province"
          options={pakistanProvinces}
          value={province}
          onChange={onProvinceChange}
          placeholder="Select province"
          allowNew
          onNewValue={async (v) => onProvinceChange(v)}
        />
      )}
      {meta?.parentLabel === 'District' && (
        <Input
          value={city}
          onChange={(e) => onCityChange(e.target.value)}
          placeholder="District name (parent)"
        />
      )}
      {meta?.parentLabel === 'City' && (
        <Input
          value={city}
          onChange={(e) => onCityChange(e.target.value)}
          placeholder="City name (optional parent)"
        />
      )}
    </div>
  )
}

export function MasterDataPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [typeFilter, setTypeFilter] = useState('district')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editItem, setEditItem] = useState<LocationValue | null>(null)
  const [value, setValue] = useState('')
  const [province, setProvince] = useState('')
  const [city, setCity] = useState('')

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['location-values', typeFilter],
    queryFn: () => locationValuesApi.getAll(typeFilter),
  })

  const { page, setPage, paginated, total, totalPages } = usePagination(items, [
    typeFilter,
    items.length,
  ])

  const resetForm = () => {
    setEditItem(null)
    setValue('')
    setProvince('')
    setCity('')
  }

  const openCreate = () => {
    resetForm()
    setDialogOpen(true)
  }

  const openEdit = (item: LocationValue) => {
    setEditItem(item)
    setValue(item.value)
    setProvince(item.province ?? '')
    setCity(item.city ?? '')
    setDialogOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        value: value.trim(),
        province: province.trim() || undefined,
        city: city.trim() || undefined,
      }
      if (editItem) {
        return locationValuesApi.update(editItem.id, payload)
      }
      return locationValuesApi.create({
        type: typeFilter,
        ...payload,
      })
    },
    onSuccess: () => {
      toast({ title: editItem ? 'Value updated' : 'Value added' })
      setDialogOpen(false)
      resetForm()
      queryClient.invalidateQueries({ queryKey: ['location-values'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Save failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => locationValuesApi.delete(id),
    onSuccess: () => {
      toast({ title: 'Value deleted' })
      queryClient.invalidateQueries({ queryKey: ['location-values'] })
    },
    onError: () => {
      toast({ title: 'Delete failed', variant: 'destructive' })
    },
  })

  if (user?.role !== 'IT_ADMIN' && user?.role !== 'SUPER_ADMIN') {
    return <Navigate to="/dashboard" replace />
  }

  const meta = typeMeta(typeFilter)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Master Data</h1>
        <p className="text-sm text-text-secondary">
          Manage provinces, cities, districts, tehsils, and police stations used
          in employee forms. IT-added values appear in dropdowns immediately.
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Label>Data type</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCATION_VALUE_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button className="bg-primary hover:bg-primary-dark" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add {meta?.label ?? 'Value'}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <TableRecordCount count={paginated.length} total={total} label={meta?.label ?? 'record'} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Province</TableHead>
                <TableHead>Parent / City</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(4)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-text-secondary">
                    No {meta?.label.toLowerCase()} records yet
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.value}</TableCell>
                    <TableCell>{item.province ?? '—'}</TableCell>
                    <TableCell>{item.city ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete "${item.value}" from ${meta?.label}?`,
                              )
                            ) {
                              deleteMutation.mutate(item.id)
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            totalPages={totalPages}
            total={total}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) resetForm()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editItem ? 'Edit' : 'Add'} {meta?.label}
            </DialogTitle>
          </DialogHeader>
          <ValueFormFields
            type={typeFilter}
            value={value}
            province={province}
            city={city}
            onValueChange={setValue}
            onProvinceChange={setProvince}
            onCityChange={setCity}
          />
          <DialogFooter>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={!value.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
