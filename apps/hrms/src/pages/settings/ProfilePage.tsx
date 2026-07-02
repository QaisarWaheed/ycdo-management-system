import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { employeesApi } from '@/api/endpoints/employees'
import { EmployeeAvatar } from '@/components/employees/EmployeeAvatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { formatBranchLabel } from '@/lib/formatBranchLabel'

export function ProfilePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')

  const { data: employee } = useQuery({
    queryKey: ['employee-profile', user?.employeeId],
    queryFn: () => employeesApi.getOne(user!.employeeId!),
    enabled: !!user?.employeeId,
  })

  useEffect(() => {
    if (employee) {
      setFullName(employee.fullName)
      setPhone(employee.phone ?? '')
    }
  }, [employee])

  const updateMutation = useMutation({
    mutationFn: () =>
      employeesApi.update(user!.employeeId!, {
        fullName,
        phone: phone || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Profile updated' })
      queryClient.invalidateQueries({ queryKey: ['employee-profile'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to update profile',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const displayName = employee?.fullName ?? user?.email ?? 'User'

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">Profile Settings</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="flex flex-col items-center space-y-4 p-6 text-center">
            <EmployeeAvatar
              fullName={employee?.fullName ?? user?.email ?? 'User'}
              photoUrl={employee?.photoUrl}
              size="lg"
            />
            <div>
              <p className="text-xl font-bold">{displayName}</p>
              <Badge variant="outline" className="mt-2">
                {user?.role?.replace(/_/g, ' ')}
              </Badge>
            </div>
            {employee?.employeeCode && (
              <p className="font-mono text-sm text-text-secondary">
                {employee.employeeCode}
              </p>
            )}
            <p className="text-sm text-text-secondary">{user?.email}</p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="space-y-4 p-6">
            <h2 className="text-lg font-semibold">Edit Profile</h2>
            {user?.employeeId ? (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Full Name</Label>
                    <Input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-text-secondary">Designation</Label>
                    <Input
                      value={employee?.currentDesignation ?? '—'}
                      disabled
                      className="bg-muted"
                    />
                  </div>
                </div>
                <Button
                  onClick={() => updateMutation.mutate()}
                  disabled={updateMutation.isPending}
                  className="bg-primary hover:bg-primary-dark"
                >
                  {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </>
            ) : (
              <p className="text-sm text-text-secondary">
                Profile editing is only available for employee accounts.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {employee?.currentBranch && (
        <Card>
          <CardContent className="p-6">
            <h2 className="mb-2 text-lg font-semibold">Work Information</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-text-secondary">Branch</p>
                <p className="font-medium">
                  {formatBranchLabel(employee.currentBranch)}
                </p>
              </div>
              <div>
                <p className="text-sm text-text-secondary">Department</p>
                <p className="font-medium">
                  {employee.currentDepartment?.name ?? '—'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
