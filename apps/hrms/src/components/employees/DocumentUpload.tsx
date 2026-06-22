import { Upload } from 'lucide-react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { DocumentType } from '@/types'
import { cn } from '@/lib/utils'

interface DocumentUploadProps {
  documentType: DocumentType
  onTypeChange: (type: DocumentType) => void
  file: File | null
  onFileChange: (file: File | null) => void
  types?: DocumentType[]
  label?: string
}

const defaultTypes: DocumentType[] = [
  'CNIC',
  'EDUCATIONAL_CERTIFICATE',
  'MEDICAL_CERTIFICATE',
]

export function DocumentUpload({
  documentType,
  onTypeChange,
  file,
  onFileChange,
  types = defaultTypes,
  label = 'Document Type',
}: DocumentUploadProps) {
  return (
    <div className="space-y-3 rounded-lg border border-dashed border-border p-4">
      <div className="space-y-2">
        <Label>{label}</Label>
        <Select
          value={documentType}
          onValueChange={(v) => onTypeChange(v as DocumentType)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {types.map((t) => (
              <SelectItem key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <label
        className={cn(
          'flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-border bg-surface p-6 transition-colors hover:bg-muted',
        )}
      >
        <Upload className="h-8 w-8 text-text-secondary" />
        <span className="text-sm text-text-secondary">
          {file ? file.name : 'Click or drag file to upload'}
        </span>
        <input
          type="file"
          className="hidden"
          accept=".jpg,.jpeg,.png,.pdf"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />
      </label>
    </div>
  )
}
