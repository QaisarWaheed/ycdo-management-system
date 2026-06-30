import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ExternalLink, Pencil, X } from 'lucide-react'
import { employeesApi } from '@/api/endpoints/employees'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
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
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { formatDutyDisplay } from '@/lib/dutyTimes'

export function MyProfilePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const employeeId = user?.employeeId ?? ''

  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')

  const { data: employee, isLoading } = useQuery({
    queryKey: ['employee-profile', employeeId],
    queryFn: () => employeesApi.getOne(employeeId),
    enabled: !!employeeId,
  })

  const { data: documents = [], isLoading: loadingDocs } = useQuery({
    queryKey: ['employee-documents', employeeId],
    queryFn: () => employeesApi.getDocuments(employeeId),
    enabled: !!employeeId,
  })

  useEffect(() => {
    if (employee) {
      setPhone(employee.phone ?? '')
      setEmail(employee.email ?? user?.email ?? '')
    }
  }, [employee, user?.email])

  const updateMutation = useMutation({
    mutationFn: () =>
      employeesApi.update(employeeId, {
        phone: phone || undefined,
        email: email || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Profile updated successfully' })
      queryClient.invalidateQueries({ queryKey: ['employee-profile'] })
      setEditing(false)
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
    : user?.email ?? 'Employee'

  const initials = employee
    ? `${employee.firstName[0]}${employee.lastName[0]}`.toUpperCase()
    : 'EP'

  const handleCancelEdit = () => {
    if (employee) {
      setPhone(employee.phone ?? '')
      setEmail(employee.email ?? user?.email ?? '')
    }
    setEditing(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">My Profile</h1>
        <p className="text-sm text-text-secondary">
          View your personal information and documents
        </p>
      </div>

      <Card className="border-border shadow-sm">
        <CardContent className="flex flex-col items-center gap-4 p-6 sm:flex-row sm:items-start">
          {isLoading ? (
            <Skeleton className="h-20 w-20 rounded-full" />
          ) : (
            <Avatar className="h-20 w-20">
              <AvatarFallback className="bg-primary text-2xl text-white">
                {initials}
              </AvatarFallback>
            </Avatar>
          )}
          <div className="flex-1 text-center sm:text-left">
            {isLoading ? (
              <Skeleton className="mx-auto h-8 w-48 sm:mx-0" />
            ) : (
              <>
                <h2 className="text-xl font-bold">{displayName}</h2>
                <p className="font-mono text-sm text-text-secondary">
                  {employee?.employeeCode}
                </p>
                <div className="mt-2 flex flex-wrap justify-center gap-2 sm:justify-start">
                  <Badge variant="outline">{employee?.currentDesignation}</Badge>
                  <Badge variant="outline" className="bg-green-50">
                    {employee?.status}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-text-secondary">
                  {employee?.currentBranch?.name}
                  {employee?.currentDepartment &&
                    ` · ${employee.currentDepartment.name}`}
                </p>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="personal">
        <TabsList>
          <TabsTrigger value="personal">Personal Info</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="personal" className="mt-4">
          <Card className="border-border shadow-sm">
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Personal Information</h3>
                {!editing ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit Contact
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelEdit}
                    >
                      <X className="mr-1 h-4 w-4" />
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="bg-primary hover:bg-primary-dark"
                      disabled={updateMutation.isPending}
                      onClick={() => updateMutation.mutate()}
                    >
                      Save
                    </Button>
                  </div>
                )}
              </div>

              <Separator />

              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(6)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-text-secondary">Full Name</Label>
                    <p className="font-medium">{displayName}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-text-secondary">CNIC</Label>
                    <p className="font-medium">{employee?.cnic}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-text-secondary">Gender</Label>
                    <p className="font-medium">{employee?.gender}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-text-secondary">Date of Birth</Label>
                    <p className="font-medium">
                      {employee?.dateOfBirth
                        ? format(new Date(employee.dateOfBirth), 'dd/MM/yyyy')
                        : '—'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-text-secondary">Joining Date</Label>
                    <p className="font-medium">
                      {employee?.joiningDate
                        ? format(new Date(employee.joiningDate), 'dd/MM/yyyy')
                        : '—'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-text-secondary">Province</Label>
                    <p className="font-medium">{employee?.province ?? '—'}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-text-secondary">City</Label>
                    <p className="font-medium">{employee?.city ?? '—'}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-text-secondary">Domicile</Label>
                    <p className="font-medium">{employee?.domicile ?? '—'}</p>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-text-secondary">Current Address</Label>
                    <p className="font-medium">
                      {employee?.currentAddress ?? employee?.address ?? '—'}
                    </p>
                  </div>
                  {employee?.permanentAddress && (
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-text-secondary">
                        Permanent Address
                      </Label>
                      <p className="font-medium">{employee.permanentAddress}</p>
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label className="text-text-secondary">Branch</Label>
                    <p className="font-medium">
                      {employee?.currentBranch?.name ?? '—'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-text-secondary">Duty Hours</Label>
                    <p className="font-medium">
                      {formatDutyDisplay(
                        employee?.dutyStartTime,
                        employee?.dutyEndTime,
                      )}
                    </p>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <p className="text-sm text-amber-700">
                      Branch and duty hours can only be updated by HR.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    {editing ? (
                      <Input
                        id="phone"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+92 300 1234567"
                      />
                    ) : (
                      <p className="font-medium">{employee?.phone ?? '—'}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    {editing ? (
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    ) : (
                      <p className="font-medium">
                        {employee?.email ?? user?.email ?? '—'}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <div className="rounded-lg border border-border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>File Name</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingDocs ? (
                  [...Array(3)].map((_, i) => (
                    <TableRow key={i}>
                      {[...Array(4)].map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : documents.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-8 text-center text-text-secondary"
                    >
                      No documents on file
                    </TableCell>
                  </TableRow>
                ) : (
                  documents.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell>
                        {doc.documentType.replace(/_/g, ' ')}
                      </TableCell>
                      <TableCell>{doc.fileName}</TableCell>
                      <TableCell>
                        {format(new Date(doc.uploadedAt), 'dd/MM/yyyy')}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" asChild>
                          <a
                            href={doc.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
