import { useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { exportToCsv } from '@/lib/exportCsv'

export type ReportFilterConfig = {
  key: string
  label: string
  type: 'text' | 'date' | 'select' | 'number'
  options?: { value: string; label: string }[]
  defaultValue?: string
}

export type ReportColumnConfig = {
  key: string
  label: string
  render?: (row: Record<string, unknown>) => React.ReactNode
}

type ReportModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  reportTitle: string
  filters: ReportFilterConfig[]
  columns: ReportColumnConfig[]
  fetchFn: (filters: Record<string, string>) => Promise<Record<string, unknown>[]>
  filename?: string
  extraContent?:
    | React.ReactNode
    | ((results: Record<string, unknown>[]) => React.ReactNode)
}

export function ReportModal({
  open,
  onOpenChange,
  reportTitle,
  filters,
  columns,
  fetchFn,
  filename,
  extraContent,
}: ReportModalProps) {
  const initialFilters = Object.fromEntries(
    filters.map((f) => [f.key, f.defaultValue ?? '']),
  )
  const [filterValues, setFilterValues] = useState(initialFilters)
  const [results, setResults] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(false)
  const [ran, setRan] = useState(false)

  const runReport = async () => {
    setLoading(true)
    try {
      const data = await fetchFn(filterValues)
      setResults(data)
      setRan(true)
    } finally {
      setLoading(false)
    }
  }

  const handlePrint = () => {
    window.print()
  }

  const handleExport = () => {
    exportToCsv(results, filename ?? reportTitle.replace(/\s+/g, '_'), columns)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto print:max-h-none sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{reportTitle}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 print:hidden">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filters.map((filter) => (
              <div key={filter.key} className="space-y-1">
                <Label>{filter.label}</Label>
                {filter.type === 'select' ? (
                  <Select
                    value={filterValues[filter.key]}
                    onValueChange={(v) =>
                      setFilterValues((prev) => ({ ...prev, [filter.key]: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={`Select ${filter.label}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {filter.options?.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={
                      filter.type === 'date'
                        ? 'date'
                        : filter.type === 'number'
                          ? 'number'
                          : 'text'
                    }
                    value={filterValues[filter.key]}
                    onChange={(e) =>
                      setFilterValues((prev) => ({
                        ...prev,
                        [filter.key]: e.target.value,
                      }))
                    }
                  />
                )}
              </div>
            ))}
          </div>
          <Button
            className="bg-primary hover:bg-primary-dark"
            onClick={runReport}
            disabled={loading}
          >
            {loading ? 'Running...' : 'Run Report'}
          </Button>
        </div>

        {extraContent && ran && (
          <div className="print:block">
            {typeof extraContent === 'function'
              ? extraContent(results)
              : extraContent}
          </div>
        )}

        {ran && (
          <div id="report-results" className="space-y-3">
            <div className="hidden print:block">
              <h2 className="text-lg font-bold">{reportTitle}</h2>
              <p className="text-sm text-text-secondary">
                Generated {new Date().toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((col) => (
                      <TableHead key={col.key}>{col.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={columns.length}
                        className="py-8 text-center text-text-secondary"
                      >
                        No results
                      </TableCell>
                    </TableRow>
                  ) : (
                    results.map((row, i) => (
                      <TableRow key={i}>
                        {columns.map((col) => (
                          <TableCell key={col.key}>
                            {col.render
                              ? col.render(row)
                              : String(row[col.key] ?? '—')}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter className="print:hidden">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {ran && results.length > 0 && (
            <>
              <Button variant="outline" onClick={handleExport}>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
              <Button variant="outline" onClick={handlePrint}>
                <Printer className="mr-2 h-4 w-4" />
                Print
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
