import type { ChangeEvent, ReactNode } from 'react'
import type { LetterFieldDef } from '@/lib/letterFieldConfig'
import { URDU_LETTER_SUBJECT } from '@/lib/letterFieldConfig'
import type { LetterType } from '@/types'
import { cn } from '@/lib/utils'

const urduInputClass =
  'w-full rounded border border-dashed border-teal-400/80 bg-teal-50/40 px-2 py-1 text-right font-[Noto_Nastaliq_Urdu,Noto_Naskh_Arabic,Jameel_Noori_Nastaleeq,Urdu_Typesetting,Tahoma,sans-serif] text-[15px] leading-relaxed outline-none focus:border-teal-600 focus:bg-white'

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: LetterFieldDef
  value: string
  onChange: (value: string) => void
}) {
  const common = {
    dir: 'rtl' as const,
    lang: 'ur',
    className: urduInputClass,
    value,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(e.target.value),
    placeholder: field.hint ?? field.label,
  }

  if (field.type === 'textarea') {
    return <textarea {...common} rows={field.key === 'violations' ? 4 : 3} />
  }

  return (
    <input
      {...common}
      type={
        field.type === 'number'
          ? 'number'
          : field.type === 'date'
            ? 'date'
            : 'text'
      }
    />
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="mb-2 flex items-start gap-2 text-right">
      <span className="shrink-0 pt-1 font-semibold text-gray-800">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function UrduLetterCanvas({
  letterType,
  fields,
  onChange,
  templateFields,
  className,
}: {
  letterType: LetterType
  fields: Record<string, string>
  onChange: (key: string, value: string) => void
  templateFields: LetterFieldDef[]
  className?: string
}) {
  const byKey = Object.fromEntries(templateFields.map((f) => [f.key, f]))
  const subject = URDU_LETTER_SUBJECT[letterType] ?? letterType
  const get = (key: string) => fields[key] ?? ''
  const set = (key: string) => (value: string) => onChange(key, value)

  return (
    <div
      className={cn(
        'rounded-lg border bg-[#fffef8] p-5 shadow-sm',
        className,
      )}
      dir="rtl"
      lang="ur"
      style={{
        fontFamily:
          '"Noto Nastaliq Urdu", "Noto Naskh Arabic", "Jameel Noori Nastaleeq", "Urdu Typesetting", Tahoma, sans-serif',
      }}
    >
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&family=Noto+Naskh+Arabic:wght@400;700&display=swap"
      />

      {letterType === 'WARNING' ? (
        <div className="mb-4 text-center">
          <div className="text-lg font-bold leading-snug" dir="ltr">
            Notification
            <br />
            Prescribed Letter of Warning
          </div>
          <p className="mt-1 text-xs text-gray-600" dir="ltr">
            It is notified that following notified format is approved for
            warning Letter
          </p>
        </div>
      ) : (
        <div className="mb-4 text-center text-base font-bold">{subject}</div>
      )}

      <div className="mb-4 space-y-1 text-[15px]">
        {byKey.senderTitle && (
          <Row label="منجانب:">
            <FieldInput
              field={byKey.senderTitle}
              value={get('senderTitle')}
              onChange={set('senderTitle')}
            />
          </Row>
        )}
        {byKey.employeeName && (
          <Row label="بجانب:">
            <div className="space-y-1">
              <FieldInput
                field={byKey.employeeName}
                value={get('employeeName')}
                onChange={set('employeeName')}
              />
              {byKey.designation && (
                <FieldInput
                  field={byKey.designation}
                  value={get('designation')}
                  onChange={set('designation')}
                />
              )}
            </div>
          </Row>
        )}
        {byKey.branch && (
          <Row label="برانچ:">
            <FieldInput
              field={byKey.branch}
              value={get('branch')}
              onChange={set('branch')}
            />
          </Row>
        )}
        <div className="text-sm text-gray-600">
          عنوان: <span className="font-semibold text-gray-900">{subject}</span>
        </div>
      </div>

      <p className="mb-3 font-bold">السلام علیکم!</p>

      {/* Body / reason fields */}
      <div className="space-y-3 text-[15px] leading-relaxed">
        {byKey.violations && (
          <div>
            <div className="mb-1 font-semibold">خلاف ورزیاں:</div>
            <FieldInput
              field={byKey.violations}
              value={get('violations')}
              onChange={set('violations')}
            />
          </div>
        )}
        {byKey.adviceReason && (
          <FieldInput
            field={byKey.adviceReason}
            value={get('adviceReason')}
            onChange={set('adviceReason')}
          />
        )}
        {byKey.adviceDetails && (
          <FieldInput
            field={byKey.adviceDetails}
            value={get('adviceDetails')}
            onChange={set('adviceDetails')}
          />
        )}
        {byKey.disciplinaryReason && (
          <FieldInput
            field={byKey.disciplinaryReason}
            value={get('disciplinaryReason')}
            onChange={set('disciplinaryReason')}
          />
        )}
        {byKey.incidentDate && (
          <Row label="تاریخِ واقعہ:">
            <FieldInput
              field={byKey.incidentDate}
              value={get('incidentDate')}
              onChange={set('incidentDate')}
            />
          </Row>
        )}
        {byKey.allegation && (
          <FieldInput
            field={byKey.allegation}
            value={get('allegation')}
            onChange={set('allegation')}
          />
        )}
        {byKey.issueDescription && (
          <FieldInput
            field={byKey.issueDescription}
            value={get('issueDescription')}
            onChange={set('issueDescription')}
          />
        )}
        {byKey.responseDeadline && (
          <Row label="آخری تاریخِ جواب:">
            <FieldInput
              field={byKey.responseDeadline}
              value={get('responseDeadline')}
              onChange={set('responseDeadline')}
            />
          </Row>
        )}
        {byKey.fineReason && (
          <FieldInput
            field={byKey.fineReason}
            value={get('fineReason')}
            onChange={set('fineReason')}
          />
        )}
        {byKey.fineAmount && (
          <Row label="جرمانہ:">
            <FieldInput
              field={byKey.fineAmount}
              value={get('fineAmount')}
              onChange={set('fineAmount')}
            />
          </Row>
        )}
        {byKey.deductionMonth && (
          <Row label="ماہِ کٹوتی:">
            <FieldInput
              field={byKey.deductionMonth}
              value={get('deductionMonth')}
              onChange={set('deductionMonth')}
            />
          </Row>
        )}
        {byKey.inquiryReason && (
          <FieldInput
            field={byKey.inquiryReason}
            value={get('inquiryReason')}
            onChange={set('inquiryReason')}
          />
        )}
        {byKey.inquiryDate && (
          <Row label="تاریخِ انکوائری:">
            <FieldInput
              field={byKey.inquiryDate}
              value={get('inquiryDate')}
              onChange={set('inquiryDate')}
            />
          </Row>
        )}
        {byKey.committeeMembers && (
          <Row label="کمیٹی:">
            <FieldInput
              field={byKey.committeeMembers}
              value={get('committeeMembers')}
              onChange={set('committeeMembers')}
            />
          </Row>
        )}
        {byKey.appreciationReason && (
          <FieldInput
            field={byKey.appreciationReason}
            value={get('appreciationReason')}
            onChange={set('appreciationReason')}
          />
        )}
        {byKey.achievementDetails && (
          <FieldInput
            field={byKey.achievementDetails}
            value={get('achievementDetails')}
            onChange={set('achievementDetails')}
          />
        )}
        {byKey.rewardAmount && (
          <Row label="انعام:">
            <FieldInput
              field={byKey.rewardAmount}
              value={get('rewardAmount')}
              onChange={set('rewardAmount')}
            />
          </Row>
        )}
        {byKey.suspensionReason && (
          <FieldInput
            field={byKey.suspensionReason}
            value={get('suspensionReason')}
            onChange={set('suspensionReason')}
          />
        )}
        {byKey.suspensionStartDate && (
          <Row label="آغاز:">
            <FieldInput
              field={byKey.suspensionStartDate}
              value={get('suspensionStartDate')}
              onChange={set('suspensionStartDate')}
            />
          </Row>
        )}
        {byKey.suspensionDuration && (
          <Row label="مدت:">
            <FieldInput
              field={byKey.suspensionDuration}
              value={get('suspensionDuration')}
              onChange={set('suspensionDuration')}
            />
          </Row>
        )}
        {byKey.terminationReason && (
          <FieldInput
            field={byKey.terminationReason}
            value={get('terminationReason')}
            onChange={set('terminationReason')}
          />
        )}
        {byKey.terminationDate && (
          <Row label="آخری یوم:">
            <FieldInput
              field={byKey.terminationDate}
              value={get('terminationDate')}
              onChange={set('terminationDate')}
            />
          </Row>
        )}
        {byKey.settlementDetails && (
          <FieldInput
            field={byKey.settlementDetails}
            value={get('settlementDetails')}
            onChange={set('settlementDetails')}
          />
        )}
        {byKey.reinstatementDate && (
          <Row label="بحالی:">
            <FieldInput
              field={byKey.reinstatementDate}
              value={get('reinstatementDate')}
              onChange={set('reinstatementDate')}
            />
          </Row>
        )}
        {byKey.reinstatedDesignation && (
          <Row label="عہدہ:">
            <FieldInput
              field={byKey.reinstatedDesignation}
              value={get('reinstatedDesignation')}
              onChange={set('reinstatedDesignation')}
            />
          </Row>
        )}
        {byKey.rejoiningDate && (
          <Row label="واپسی:">
            <FieldInput
              field={byKey.rejoiningDate}
              value={get('rejoiningDate')}
              onChange={set('rejoiningDate')}
            />
          </Row>
        )}
        {byKey.rejoiningDesignation && (
          <Row label="عہدہ:">
            <FieldInput
              field={byKey.rejoiningDesignation}
              value={get('rejoiningDesignation')}
              onChange={set('rejoiningDesignation')}
            />
          </Row>
        )}
        {byKey.lastWorkingDate && (
          <Row label="آخری یوم:">
            <FieldInput
              field={byKey.lastWorkingDate}
              value={get('lastWorkingDate')}
              onChange={set('lastWorkingDate')}
            />
          </Row>
        )}
        {byKey.totalExperience && (
          <Row label="تجربہ:">
            <FieldInput
              field={byKey.totalExperience}
              value={get('totalExperience')}
              onChange={set('totalExperience')}
            />
          </Row>
        )}
        {byKey.jobDescription && (
          <FieldInput
            field={byKey.jobDescription}
            value={get('jobDescription')}
            onChange={set('jobDescription')}
          />
        )}
      </div>

      <div className="mt-8 text-sm text-gray-700">
        <div>{get('senderTitle') || '…………………'}</div>
        <div>YCDO ملتان پاکستان</div>
      </div>

      <p className="mt-3 text-center text-xs text-teal-700">
        اردو میں خانوں میں ٹائپ کریں — یہی متن خط پر جائے گا
      </p>
    </div>
  )
}
