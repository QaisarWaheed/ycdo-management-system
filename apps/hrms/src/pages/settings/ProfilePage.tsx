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

export function ProfilePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')

  const { data: employee } = useQuery({
    queryKey: ['employee-profile', user?.employeeId],
    queryFn: () => employeesApi.getOne(user!.employeeId!),
    enabled: !!user?.employeeId,
  })

  useEffect(() => {
    if (employee) {
      setFirstName(employee.firstName)
      setLastName(employee.lastName)
      setPhone(employee.phone ?? '')
    }
  }, [employee])

  const updateMutation = useMutation({
    mutationFn: () =>
      employeesApi.update(user!.employeeId!, {
        firstName,
        lastName,
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

  const displayName = employee
    ? `${employee.firstName} ${employee.lastName}`
    : user?.email ?? 'User'

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">Profile Settings</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="flex flex-col items-center space-y-4 p-6 text-center">
            <EmployeeAvatar
              firstName={employee?.firstName ?? user?.email?.[0] ?? 'U'}
              lastName={employee?.lastName ?? ''}
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
                  <div className="space-y-2">
                    <Label>First Name</Label>
                    <Input
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Last Name</Label>
                    <Input
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
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
                  <div className="space-y-2">
                    <Label className="text-text-secondary">Department</Label>
                    <Input
                      value={employee?.currentDepartment?.name ?? '—'}
                      disabled
                      className="bg-muted"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-text-secondary">Branch</Label>
                    <Input
                      value={employee?.currentBranch?.name ?? '—'}
                      disabled
                      className="bg-muted"
                    />
                  </div>
                </div>
                <Button
                  className="bg-primary hover:bg-primary-dark"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate()}
                >
                  {updateMutation.isPending ? 'Saving...' : 'Save Profile'}
                </Button>
              </>
            ) : (
              <p className="text-text-secondary">
                No employee profile linked to this account.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
