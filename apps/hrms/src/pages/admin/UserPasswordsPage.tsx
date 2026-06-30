import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { KeyRound, Pencil } from 'lucide-react'
import { userPasswordsApi, type UserPasswordRecord } from '@/api/endpoints/userPasswords'
import { Badge } from '@/components/ui/badge'
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

function ResetPasswordDialog({
  record,
  open,
  onOpenChange,
}: {
  record: UserPasswordRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [newPassword, setNewPassword] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      userPasswordsApi.resetPassword(record!.userId, newPassword),
    onSuccess: () => {
      toast({ title: 'Password updated' })
      setNewPassword('')
      onOpenChange(false)
      queryClient.invalidateQueries({ queryKey: ['user-passwords'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to reset password',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setNewPassword('')
        onOpenChange(v)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
        </DialogHeader>
        {record && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Reset password for{' '}
              <span className="font-medium text-text-primary">
                {record.user.email}
              </span>
            </p>
            <div className="space-y-2">
              <Label>New Password</Label>
              <Input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 6 characters"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={newPassword.length < 6 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving...' : 'Update Password'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function UserPasswordsPage() {
  const [resetRecord, setResetRecord] = useState<UserPasswordRecord | null>(null)

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['user-passwords'],
    queryFn: () => userPasswordsApi.getAll(),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <KeyRound className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">User Passwords</h1>
          <p className="text-sm text-text-secondary">
            View and reset user account passwords
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Password</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-[120px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(5)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-text-secondary">
                  No user passwords found
                </TableCell>
              </TableRow>
            ) : (
              records.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="font-medium">{record.user.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {record.user.role.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{record.plainText}</TableCell>
                  <TableCell>
                    {format(new Date(record.updatedAt), 'dd/MM/yyyy HH:mm')}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setResetRecord(record)}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      Reset
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ResetPasswordDialog
        record={resetRecord}
        open={!!resetRecord}
        onOpenChange={(open) => !open && setResetRecord(null)}
      />
    </div>
  )
}
