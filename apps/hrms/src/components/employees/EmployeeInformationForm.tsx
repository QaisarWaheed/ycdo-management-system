import type { ReactNode } from 'react'
import { BadgeCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  EmployeeInformationFormData,
  QualificationRow,
} from '@/lib/employeeInformationFormData'

function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 border-b border-slate-100 pb-2 text-sm font-semibold tracking-wide text-slate-800">
        {title}
      </h3>
      {children}
    </section>
  )
}

function InfoGrid({
  items,
}: {
  items: { label: string; value: string }[]
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            {item.label}
          </p>
          <p className="mt-0.5 break-words text-sm font-medium text-slate-900">
            {item.value || '—'}
          </p>
        </div>
      ))}
    </div>
  )
}

function QualList({
  title,
  rows,
}: {
  title: string
  rows: QualificationRow[]
}) {
  const filled = rows.filter((r) => r.degree || r.boardUniversity)
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-slate-600">{title}</p>
      {filled.length === 0 ? (
        <p className="text-sm text-slate-400">None recorded</p>
      ) : (
        <ul className="space-y-2">
          {filled.map((row, i) => (
            <li
              key={i}
              className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800"
            >
              <span className="font-medium">{row.degree || '—'}</span>
              {row.boardUniversity ? (
                <span className="text-slate-500"> · {row.boardUniversity}</span>
              ) : null}
              {(row.marks || row.division) && (
                <span className="mt-0.5 block text-xs text-slate-500">
                  {[row.marks, row.division].filter(Boolean).join(' · ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ApproverChip({
  label,
  highlight,
}: {
  label: string
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-3 text-center text-xs font-medium',
        highlight
          ? 'border-amber-400 bg-amber-50 text-amber-900 ring-2 ring-amber-300'
          : 'border-slate-200 bg-slate-50 text-slate-600',
      )}
    >
      {label}
      {highlight && (
        <p className="mt-1 text-[10px] font-normal text-amber-700">
          Selected approver
        </p>
      )}
    </div>
  )
}

/**
 * System-generated HRMS confirmation record.
 * Intentionally distinct from the paper Employee Information Form (form.pdf):
 * modern cards, English-only, no black grid / bilingual paper layout.
 */
export function EmployeeInformationForm({
  data,
  className,
  showPendingApprover,
}: {
  data: EmployeeInformationFormData
  className?: string
  showPendingApprover?: boolean
}) {
  const job = data.previousJobs[0]

  return (
    <div
      className={cn(
        'employee-information-form mx-auto w-full max-w-[210mm] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 text-slate-900',
        className,
      )}
    >
      <div className="bg-gradient-to-r from-teal-700 to-teal-600 px-5 py-4 text-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
              <BadgeCheck className="h-3.5 w-3.5" />
              System generated · HRMS
            </div>
            <h1 className="text-lg font-semibold tracking-tight">
              Employee Onboarding Confirmation
            </h1>
            <p className="mt-0.5 text-sm text-teal-50/90">
              Digital record of details entered by HR — compare with the
              physical form
            </p>
          </div>
          <div className="rounded-lg bg-white/10 px-3 py-2 text-right text-sm backdrop-blur-sm">
            <p className="text-[10px] uppercase tracking-wide text-teal-100">
              Employee code
            </p>
            <p className="font-semibold">{data.code || 'Pending'}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <Section title="Personal details">
          <div className="mb-4 flex flex-col gap-4 sm:flex-row">
            <div className="h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
              {data.photoUrl ? (
                <img
                  src={data.photoUrl}
                  alt={data.fullName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                  No photo
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <InfoGrid
                items={[
                  { label: 'Full name', value: data.fullName },
                  { label: 'Father name', value: data.fatherName },
                  { label: 'CNIC', value: data.cnic },
                  { label: 'Phone', value: data.phone },
                  { label: 'Email', value: data.email },
                  { label: 'Date of birth', value: data.dateOfBirth },
                  { label: 'Gender', value: data.gender },
                  { label: 'Marital status', value: data.maritalStatus },
                  { label: 'Blood group', value: data.bloodGroup },
                  { label: 'Caste', value: data.caste },
                ]}
              />
            </div>
          </div>
        </Section>

        <Section title="Address & domicile">
          <InfoGrid
            items={[
              { label: 'Domicile', value: data.domicile },
              { label: 'District', value: data.district },
              { label: 'Tehsil', value: data.tehsil },
              { label: 'Police station', value: data.policeStation },
              { label: 'Current address', value: data.currentAddress },
              { label: 'Permanent address', value: data.permanentAddress },
              {
                label: 'Emergency contact',
                value: data.emergencyGuardianContact,
              },
              { label: 'Spouse', value: data.spouseName },
              { label: 'Spouse contact', value: data.spouseContact },
              { label: 'Father contact', value: data.fatherContact },
            ]}
          />
        </Section>

        <Section title="Job placement">
          <InfoGrid
            items={[
              { label: 'Joining date', value: data.joiningDate },
              { label: 'Posting / branch', value: data.postingPlace },
              { label: 'Designation', value: data.designation },
              { label: 'Stipend', value: data.stipend },
              { label: 'Submitted by', value: data.submittedBy },
            ]}
          />
        </Section>

        <Section title="Qualifications">
          <div className="space-y-4">
            <QualList
              title="Academic"
              rows={data.academicQualifications}
            />
            <QualList
              title="Job-relevant"
              rows={data.jobQualifications}
            />
          </div>
        </Section>

        <Section title="Previous employment">
          <InfoGrid
            items={[
              {
                label: 'Organization',
                value: job?.organizationName ?? '',
              },
              {
                label: 'Owner / admin',
                value: job?.ownerAdminName ?? '',
              },
              { label: 'Contact', value: job?.contactNumber ?? '' },
              {
                label: 'Postal address',
                value: job?.postalAddress ?? '',
              },
            ]}
          />
          {data.experienceNotes ? (
            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {data.experienceNotes}
            </p>
          ) : null}
        </Section>

        <Section title="Approval routing">
          <p className="mb-3 text-xs text-slate-500">
            Confirm that the physical form matches this system record before
            approving.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ApproverChip label="HR Admin Manager" />
            <ApproverChip label="HR Operations" />
            <ApproverChip
              label="Chairman Admin"
              highlight={
                showPendingApprover && data.approverTarget === 'CHAIRMAN_ADMIN'
              }
            />
            <ApproverChip
              label="Founder"
              highlight={
                showPendingApprover && data.approverTarget === 'FOUNDER'
              }
            />
          </div>
          {showPendingApprover && data.approverTarget === 'PRESIDENT' && (
            <div className="mt-2">
              <ApproverChip label="President" highlight />
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}
