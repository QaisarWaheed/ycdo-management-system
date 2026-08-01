import { useState, type ReactNode } from 'react'
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

function PhotoBox({
  url,
  fullName,
}: {
  url?: string | null
  fullName: string
}) {
  const [failed, setFailed] = useState(false)

  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <div className="h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
      {url && !failed ? (
        <img
          src={url}
          alt={fullName}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-400">
          <span className="text-2xl font-semibold text-slate-500">
            {initials || '—'}
          </span>
          <span className="text-[10px]">
            {failed ? 'Photo unavailable' : 'No photo'}
          </span>
        </div>
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
  hideApprovalRouting,
}: {
  data: EmployeeInformationFormData
  className?: string
  showPendingApprover?: boolean
  /** Executive reviewers only need the employee's details, not the routing. */
  hideApprovalRouting?: boolean
}) {
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
            <PhotoBox
              key={data.photoUrl ?? 'no-photo'}
              url={data.photoUrl}
              fullName={data.fullName}
            />
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

        <Section title="Family & emergency contacts">
          <InfoGrid
            items={[
              { label: 'Father status', value: data.fatherStatus },
              ...(data.fatherStatus === 'DECEASED'
                ? [
                    {
                      label: "Guardian's contact",
                      value: data.guardianContact,
                    },
                  ]
                : [
                    {
                      label: "Father's contact",
                      value: data.fatherContact,
                    },
                  ]),
              {
                label: 'Emergency contact name',
                value: data.emergencyContactName,
              },
              { label: 'Emergency relation', value: data.emergencyRelation },
              {
                label: 'Emergency contact number',
                value: data.emergencyContactNumber,
              },
              { label: 'Spouse', value: data.spouseName },
              { label: 'Spouse contact', value: data.spouseContact },
            ]}
          />
        </Section>

        <Section title="Address & domicile">
          <InfoGrid
            items={[
              { label: 'Domicile', value: data.domicile },
              { label: 'District', value: data.district },
              { label: 'Tehsil', value: data.tehsil },
              { label: 'Police station', value: data.policeStation },
              { label: 'Province', value: data.province },
              { label: 'City', value: data.city },
              { label: 'Current address', value: data.currentAddress },
              { label: 'Permanent province', value: data.permanentProvince },
              { label: 'Permanent city', value: data.permanentCity },
              { label: 'Permanent address', value: data.permanentAddress },
            ]}
          />
        </Section>

        <Section title="Job placement">
          <InfoGrid
            items={[
              { label: 'Joining date', value: data.joiningDate },
              { label: 'Posting / branch', value: data.postingPlace },
              { label: 'Designation', value: data.designation },
              { label: 'Staff type', value: data.staffType },
              { label: 'Duty timings', value: data.dutyTimings },
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
          {data.previousJobs.length === 0 ? (
            <p className="text-sm text-slate-400">None recorded</p>
          ) : (
            <div className="space-y-3">
              {data.previousJobs.map((job, i) => (
                <div key={i} className="rounded-lg bg-slate-50 p-3">
                  <InfoGrid
                    items={[
                      { label: 'Organization', value: job.organizationName },
                      { label: 'Owner / admin', value: job.ownerAdminName },
                      { label: 'Contact', value: job.contactNumber },
                      { label: 'Postal address', value: job.postalAddress },
                      { label: 'Experience', value: job.totalExperience },
                    ]}
                  />
                </div>
              ))}
            </div>
          )}
        </Section>

        {!hideApprovalRouting && (
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
        )}
      </div>
    </div>
  )
}
