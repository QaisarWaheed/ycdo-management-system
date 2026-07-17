import { useState } from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { HospitalScopeOption, ManagerScopeInput } from '@/api/endpoints/userAccess'

type SelectedScope = ManagerScopeInput & {
  label: string
}

type HospitalScopeSelectProps = {
  options: HospitalScopeOption[]
  value: SelectedScope[]
  onChange: (scopes: SelectedScope[]) => void
  disabled?: boolean
}

function scopeKey(scope: ManagerScopeInput) {
  return `${scope.projectId}|${scope.departmentId}|${scope.designationId ?? ''}`
}

export function HospitalScopeSelect({
  options,
  value,
  onChange,
  disabled,
}: HospitalScopeSelectProps) {
  const [projectId, setProjectId] = useState(options[0]?.id ?? '')
  const [departmentId, setDepartmentId] = useState('')
  const [designationId, setDesignationId] = useState('')

  const selectedProject =
    options.find((p) => p.id === projectId) ?? options[0] ?? null
  const departments = selectedProject?.departments ?? []
  const selectedDepartment =
    departments.find((d) => d.id === departmentId) ?? null
  const designations = selectedDepartment?.designations ?? []

  const addScope = () => {
    if (!selectedProject || !selectedDepartment) return
    const designation = designations.find((d) => d.id === designationId)
    const next: SelectedScope = {
      projectId: selectedProject.id,
      departmentId: selectedDepartment.id,
      designationId: designation?.id ?? null,
      label: [
        selectedProject.name,
        selectedDepartment.name,
        designation?.title ?? 'All designations',
      ].join(' · '),
    }
    if (value.some((scope) => scopeKey(scope) === scopeKey(next))) return
    onChange([...value, next])
    setDesignationId('')
  }

  const removeScope = (key: string) => {
    onChange(value.filter((scope) => scopeKey(scope) !== key))
  }

  if (!options.length) {
    return (
      <p className="text-sm text-text-secondary">
        No hospital departments are available for scope assignment.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>Hospital management scope</Label>
        <p className="mt-1 text-xs text-text-secondary">
          Grants Admin Officer permissions for matching hospital staff, and
          also lists this employee under those department/designation staff
          views.
        </p>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Hospital project</Label>
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={selectedProject?.id ?? ''}
          disabled={disabled}
          onChange={(event) => {
            setProjectId(event.target.value)
            setDepartmentId('')
            setDesignationId('')
          }}
        >
          {options.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Department</Label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={departmentId}
            disabled={disabled}
            onChange={(event) => {
              setDepartmentId(event.target.value)
              setDesignationId('')
            }}
          >
            <option value="">Select department</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Designation (optional)</Label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={designationId}
            disabled={disabled || !departmentId}
            onChange={(event) => setDesignationId(event.target.value)}
          >
            <option value="">All designations</option>
            {designations.map((designation) => (
              <option key={designation.id} value={designation.id}>
                {designation.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || !departmentId}
        onClick={addScope}
      >
        Add scope
      </Button>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((scope) => (
            <Badge
              key={scopeKey(scope)}
              variant="secondary"
              className="flex items-center gap-1 pr-1"
            >
              <span>{scope.label}</span>
              <button
                type="button"
                className="rounded p-0.5 hover:bg-muted"
                disabled={disabled}
                onClick={() => removeScope(scopeKey(scope))}
                aria-label="Remove scope"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

export type { SelectedScope }
