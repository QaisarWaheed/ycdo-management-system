import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { letterTemplatesApi } from '@/api/endpoints/letterTemplates'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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

export function LetterTemplatesPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [deletingCode, setDeletingCode] = useState<string | null>(null)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['letter-templates', 'admin'],
    queryFn: () => letterTemplatesApi.getAll(true),
  })

  const deleteMutation = useMutation({
    mutationFn: (code: string) => letterTemplatesApi.delete(code),
    onSuccess: () => {
      toast({ title: 'Template deleted' })
      queryClient.invalidateQueries({ queryKey: ['letter-templates'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Delete failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
    onSettled: () => setDeletingCode(null),
  })

  if (user?.role !== 'IT_ADMIN' && user?.role !== 'SUPER_ADMIN') {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Letter Templates</h1>
          <p className="text-sm text-text-secondary">
            Design and edit the wording of every letter HR can issue — in Urdu
            and English — and add entirely new letter types.
          </p>
        </div>
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => navigate('/admin/letter-templates/new')}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Template
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[110px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(6)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : templates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-text-secondary">
                    No letter templates yet
                  </TableCell>
                </TableRow>
              ) : (
                templates.map((tpl) => (
                  <TableRow key={tpl.code}>
                    <TableCell className="font-medium">
                      {tpl.name}
                      {tpl.isCustom && (
                        <Badge variant="secondary" className="ml-2">
                          Custom
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-text-secondary">
                      {tpl.code}
                    </TableCell>
                    <TableCell>{tpl.primaryLanguage === 'en' ? 'English' : 'Urdu'}</TableCell>
                    <TableCell>v{tpl.version}</TableCell>
                    <TableCell>
                      <Badge variant={tpl.active ? 'default' : 'outline'}>
                        {tpl.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate(`/admin/letter-templates/${tpl.code}/edit`)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {tpl.isCustom && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700"
                            disabled={deletingCode === tpl.code}
                            onClick={() => {
                              if (window.confirm(`Delete template "${tpl.name}"?`)) {
                                setDeletingCode(tpl.code)
                                deleteMutation.mutate(tpl.code)
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
