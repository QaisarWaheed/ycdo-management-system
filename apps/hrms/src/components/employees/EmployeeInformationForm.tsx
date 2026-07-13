import { cn } from '@/lib/utils'
import type {
  EmployeeInformationFormData,
  QualificationRow,
} from '@/lib/employeeInformationFormData'

function FieldRow({
  labelEn,
  labelUr,
  value,
  className,
}: {
  labelEn: string
  labelUr?: string
  value: string
  className?: string
}) {
  return (
    <div className={cn('grid grid-cols-[1fr_1.4fr] border-b border-black text-[11px]', className)}>
      <div className="flex items-center justify-between border-r border-black px-1 py-0.5">
        <span className="font-medium">{labelEn}</span>
        {labelUr && <span className="text-[10px]">{labelUr}</span>}
      </div>
      <div className="min-h-[22px] px-1 py-0.5 font-medium">{value || '\u00A0'}</div>
    </div>
  )
}

function QualTable({
  titleEn,
  titleUr,
  rows,
  columns,
}: {
  titleEn: string
  titleUr: string
  rows: QualificationRow[]
  columns: { en: string; ur?: string; key: keyof QualificationRow }[]
}) {
  return (
    <div className="border border-black">
      <div className="flex items-center justify-between border-b border-black bg-[#f3f3f3] px-2 py-1 text-[11px] font-semibold">
        <span>{titleEn}</span>
        <span>{titleUr}</span>
      </div>
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="border border-black px-1 py-1 text-left font-semibold"
              >
                <div>{col.en}</div>
                {col.ur && <div className="font-normal">{col.ur}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td
                  key={col.key}
                  className="h-[22px] border border-black px-1 align-top"
                >
                  {row[col.key] || '\u00A0'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SignatureBox({
  label,
  highlight,
}: {
  label: string
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        'flex min-h-[56px] flex-col justify-end border border-black px-1 pb-1 text-center text-[9px]',
        highlight && 'bg-amber-50 ring-2 ring-amber-400',
      )}
    >
      <div className="mb-6 border-b border-dotted border-gray-400" />
      <span className="font-semibold">{label}</span>
    </div>
  )
}

const qualColumns = [
  { en: 'Degree/Certificate', ur: 'ڈگری/سرٹیفیکیٹ', key: 'degree' as const },
  { en: 'Board/University', ur: 'بورڈ/یونیورسٹی', key: 'boardUniversity' as const },
  { en: 'Marks', ur: 'نمبر', key: 'marks' as const },
  { en: 'Division', ur: 'ڈویژن', key: 'division' as const },
]

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
        'employee-information-form mx-auto w-full max-w-[210mm] bg-white text-black',
        className,
      )}
    >
      {/* Header */}
      <div className="mb-2 flex items-start justify-between border-b-2 border-black pb-2">
        <div>
          <p className="text-lg font-bold tracking-wide">YCDO</p>
          <p className="text-[10px] text-gray-600">
            Youth Community Development Organization
          </p>
        </div>
        <div className="text-center">
          <h1 className="text-base font-bold underline">Employee Information Form</h1>
          <p className="text-[10px]">ملازم کی معلومات کا فارم</p>
        </div>
        <div className="text-right text-[11px]">
          <p>
            <span className="font-semibold">Code:</span> {data.code}
          </p>
          <p>
            <span className="font-semibold">Page:</span> {data.page}
          </p>
        </div>
      </div>

      <div className="mb-2 grid grid-cols-[1fr_88px] gap-2">
        <div className="border border-black">
          <FieldRow labelEn="Employee Name" labelUr="نام" value={data.fullName} />
          <FieldRow labelEn="Contact" labelUr="رابطہ" value={data.phone} />
          <FieldRow labelEn="CNIC" labelUr="شناختی کارڈ" value={data.cnic} />
          <FieldRow labelEn="Father Name" labelUr="والد کا نام" value={data.fatherName} />
          <FieldRow labelEn="Contact" labelUr="رابطہ" value={data.fatherContact} />
          <FieldRow
            labelEn="Emergency Guardian Contact No."
            labelUr="ایمرجنسی"
            value={data.emergencyGuardianContact}
          />
          <FieldRow labelEn="Spouse Name" labelUr="شریک حیات" value={data.spouseName} />
          <FieldRow labelEn="Contact" labelUr="رابطہ" value={data.spouseContact} />
          <FieldRow labelEn="Date of Birth" labelUr="تاریخ پیدائش" value={data.dateOfBirth} />
          <FieldRow labelEn="Cast" labelUr="ذات" value={data.caste} />
          <FieldRow labelEn="Date Of Joining" labelUr="تاریخ تقرر" value={data.joiningDate} />
          <FieldRow labelEn="Email Address" labelUr="ای میل" value={data.email} />
          <FieldRow labelEn="Domicile" labelUr="ڈومیسائل" value={data.domicile} />
          <FieldRow labelEn="Current Address" labelUr="موجودہ پتہ" value={data.currentAddress} />
          <FieldRow
            labelEn="Permanent Address"
            labelUr="مستقل پتہ"
            value={data.permanentAddress}
          />
          <FieldRow labelEn="District" labelUr="ضلع" value={data.district} />
          <FieldRow labelEn="Tehsil" labelUr="تحصیل" value={data.tehsil} />
          <FieldRow
            labelEn="Police Station"
            labelUr="تھانہ"
            value={data.policeStation}
            className="border-b-0"
          />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex flex-1 items-center justify-center overflow-hidden border border-black bg-gray-50">
            {data.photoUrl ? (
              <img
                src={data.photoUrl}
                alt={data.fullName}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-[9px] text-gray-500">Photo</span>
            )}
          </div>
          <div className="border border-black px-1 py-0.5 text-[10px]">
            <div className="flex justify-between">
              <span>Gender</span>
              <span>جنس</span>
            </div>
            <div className="font-medium">{data.gender || '—'}</div>
          </div>
          <div className="border border-black px-1 py-0.5 text-[10px]">
            <div className="flex justify-between">
              <span>Marital Status</span>
              <span>ازدواجی</span>
            </div>
            <div className="font-medium">{data.maritalStatus || '—'}</div>
          </div>
          <div className="border border-black px-1 py-0.5 text-[10px]">
            <div className="flex justify-between">
              <span>Blood Group</span>
              <span>بلڈ گروپ</span>
            </div>
            <div className="font-medium">{data.bloodGroup || '—'}</div>
          </div>
        </div>
      </div>

      <div className="mb-2 space-y-2">
        <QualTable
          titleEn="Academic Qualifications"
          titleUr="تعلیمی قابلیت"
          rows={data.academicQualifications}
          columns={qualColumns}
        />
        <QualTable
          titleEn="Qualification Relevant To This Job"
          titleUr="ملازمت سے متعلق"
          rows={data.jobQualifications}
          columns={qualColumns}
        />
      </div>

      <div className="mb-2 border border-black">
        <div className="flex items-center justify-between border-b border-black bg-[#f3f3f3] px-2 py-1 text-[11px] font-semibold">
          <span>Last Job Institute</span>
          <span>سابقہ ادارہ</span>
        </div>
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <th className="border border-black px-1 py-1 text-left">Name Institute</th>
              <th className="border border-black px-1 py-1 text-left">Owner/Admin</th>
              <th className="border border-black px-1 py-1 text-left">Contact No.</th>
              <th className="border border-black px-1 py-1 text-left">Postal Address of Inst.</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="h-[22px] border border-black px-1">{job.organizationName || '\u00A0'}</td>
              <td className="border border-black px-1">{job.ownerAdminName || '\u00A0'}</td>
              <td className="border border-black px-1">{job.contactNumber || '\u00A0'}</td>
              <td className="border border-black px-1">{job.postalAddress || '\u00A0'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mb-2 border border-black">
        <div className="border-b border-black bg-[#f3f3f3] px-2 py-1 text-[11px] font-semibold">
          Experience / تجربہ
        </div>
        <div className="min-h-[72px] whitespace-pre-wrap px-2 py-1 text-[10px]">
          {data.experienceNotes || '•\n•\n•'}
        </div>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-4 text-[10px]">
        <div>
          <p className="mb-6 border-b border-black pb-1">
            دستخط: _______________________
          </p>
          <p className="leading-relaxed">
            میں تصدیق کرتا/کرتی ہوں کہ میرے ذریعہ فراہم کردہ تمام معلومات درست ہیں۔
          </p>
        </div>
        <div className="text-right">
          <p className="mb-1 font-semibold">Employee Signature</p>
          <p>Date: _______________</p>
        </div>
      </div>

      <div className="border-2 border-black p-2">
        <p className="mb-2 text-center text-[11px] font-bold underline">
          For Office Use Only / دفتر کے استعمال کے لیے
        </p>
        <div className="mb-2 grid grid-cols-3 gap-2 text-[10px]">
          <div>
            <span className="font-semibold">Posting Place:</span>
            <div className="mt-0.5 min-h-[18px] border-b border-black">
              {data.postingPlace || '\u00A0'}
            </div>
          </div>
          <div>
            <span className="font-semibold">Designation:</span>
            <div className="mt-0.5 min-h-[18px] border-b border-black">
              {data.designation || '\u00A0'}
            </div>
          </div>
          <div>
            <span className="font-semibold">Stipend:</span>
            <div className="mt-0.5 min-h-[18px] border-b border-black">
              {data.stipend || '\u00A0'}
            </div>
          </div>
        </div>
        <p className="mb-2 text-[9px] leading-relaxed">
          براہ کرم یقینی بنائیں کہ فارم مکمل اور درست ہے۔ HR کی جانب سے جمع کرایا گیا —
          {data.submittedBy}
        </p>
        <div className="mb-2 min-h-[40px] border-b border-dotted border-gray-500 text-[10px]">
          Admin Officer Sign / افسر کا دستخط
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SignatureBox label="HR Admin Manager" />
          <SignatureBox label="HR Operation Manager" />
          <SignatureBox
            label="Chairman Admin Depart."
            highlight={
              showPendingApprover && data.approverTarget === 'CHAIRMAN_ADMIN'
            }
          />
          <SignatureBox
            label="Founder / Head of Org."
            highlight={showPendingApprover && data.approverTarget === 'FOUNDER'}
          />
        </div>
        {showPendingApprover && data.approverTarget === 'PRESIDENT' && (
          <div className="mt-2 grid grid-cols-1">
            <SignatureBox label="President / صدر" highlight />
          </div>
        )}
      </div>
    </div>
  )
}
