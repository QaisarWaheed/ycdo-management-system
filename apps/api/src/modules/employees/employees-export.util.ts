import ExcelJS from 'exceljs';
import type {
  AcademicQualification,
  Employee,
  PreviousEmployment,
} from '@prisma/client';

export type ExportEmployee = Employee & {
  currentBranch: { name: string } | null;
  currentDepartment: { name: string } | null;
  academicQualifications: AcademicQualification[];
  previousEmployments: PreviousEmployment[];
};

type Cell = string | number | null | undefined;

const fmtDate = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

/** Personal-details columns; salary and the private photo are deliberately excluded. */
const EMPLOYEE_COLUMNS: Array<{
  header: string;
  width?: number;
  value: (e: ExportEmployee) => Cell;
}> = [
  { header: 'Employee Code', value: (e) => e.employeeCode },
  { header: 'Full Name', width: 26, value: (e) => e.fullName },
  { header: 'Father Name', width: 22, value: (e) => e.fatherName },
  { header: 'Father Status', value: (e) => e.fatherStatus },
  { header: 'CNIC', width: 18, value: (e) => e.cnic },
  { header: 'Gender', value: (e) => e.gender },
  { header: 'Marital Status', value: (e) => e.maritalStatus },
  { header: 'Date of Birth', value: (e) => fmtDate(e.dateOfBirth) },
  { header: 'Blood Group', value: (e) => e.bloodGroup },
  { header: 'Caste', value: (e) => e.caste },
  { header: 'Domicile', value: (e) => e.domicile },
  { header: 'Phone', width: 16, value: (e) => e.phone },
  { header: 'Email', width: 26, value: (e) => e.email },
  { header: 'Address', width: 30, value: (e) => e.address },
  { header: 'Current Address', width: 30, value: (e) => e.currentAddress },
  { header: 'Province', value: (e) => e.province },
  { header: 'City', value: (e) => e.city },
  { header: 'Permanent Address', width: 30, value: (e) => e.permanentAddress },
  { header: 'Permanent Province', value: (e) => e.permanentProvince },
  { header: 'Permanent City', value: (e) => e.permanentCity },
  { header: 'District', value: (e) => e.district },
  { header: 'Tehsil', value: (e) => e.tehsil },
  { header: 'Police Station', value: (e) => e.policeStation },
  { header: 'Guardian Contact', width: 16, value: (e) => e.guardianContact },
  { header: 'Father Contact', width: 16, value: (e) => e.fatherContactNumber },
  { header: 'Spouse Name', width: 22, value: (e) => e.spouseName },
  { header: 'Spouse Contact', width: 16, value: (e) => e.spouseContactNumber },
  {
    header: 'Emergency Contact Name',
    width: 22,
    value: (e) => e.emergencyContactName,
  },
  {
    header: 'Emergency Contact Number',
    width: 16,
    value: (e) => e.emergencyContactNumber,
  },
  { header: 'Emergency Relation', value: (e) => e.emergencyRelation },
  { header: 'Branch', width: 22, value: (e) => e.currentBranch?.name },
  { header: 'Department', width: 20, value: (e) => e.currentDepartment?.name },
  { header: 'Designation', width: 22, value: (e) => e.currentDesignation },
  { header: 'Status', value: (e) => e.status },
  { header: 'Staff Type', value: (e) => e.staffType },
  { header: 'Joining Date', value: (e) => fmtDate(e.joiningDate) },
  {
    header: 'Duty',
    value: (e) =>
      e.dutyStartTime && e.dutyEndTime
        ? `${e.dutyStartTime}-${e.dutyEndTime}`
        : '',
  },
  { header: 'Biometric ID', value: (e) => e.biometricId },
];

function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: Array<{ header: string; width?: number }>,
  rows: Cell[][],
) {
  const ws = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = columns.map((c) => ({ header: c.header, width: c.width ?? 14 }));
  ws.getRow(1).font = { bold: true };
  for (const row of rows) ws.addRow(row.map((v) => v ?? ''));
}

export async function buildEmployeesWorkbook(
  employees: ExportEmployee[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  addSheet(
    workbook,
    'Employees',
    EMPLOYEE_COLUMNS,
    employees.map((e) => EMPLOYEE_COLUMNS.map((c) => c.value(e))),
  );

  addSheet(
    workbook,
    'Qualifications',
    [
      { header: 'Employee Code' },
      { header: 'Full Name', width: 26 },
      { header: 'Type' },
      { header: 'Degree', width: 24 },
      { header: 'Board / University', width: 28 },
      { header: 'Marks' },
      { header: 'CGPA' },
      { header: 'Division / Grade' },
      { header: 'Status' },
      { header: 'Start Year' },
      { header: 'End Year' },
    ],
    employees.flatMap((e) =>
      e.academicQualifications.map((q) => [
        e.employeeCode,
        e.fullName,
        q.qualType,
        q.degree,
        q.boardUniversity,
        q.obtainedMarks && q.totalMarks
          ? `${q.obtainedMarks}/${q.totalMarks}`
          : q.obtainedMarks,
        q.cgpa?.toString(),
        q.divisionGrade,
        q.status,
        q.startYear,
        q.endYear,
      ]),
    ),
  );

  addSheet(
    workbook,
    'Previous Employment',
    [
      { header: 'Employee Code' },
      { header: 'Full Name', width: 26 },
      { header: 'Organization', width: 28 },
      { header: 'Owner / Admin', width: 22 },
      { header: 'Contact', width: 16 },
      { header: 'Postal Address', width: 30 },
      { header: 'Total Experience' },
      { header: 'Relevant Experience' },
      { header: 'Responsibilities', width: 40 },
    ],
    employees.flatMap((e) =>
      e.previousEmployments.map((p) => [
        e.employeeCode,
        e.fullName,
        p.organizationName,
        p.ownerAdminName,
        p.contactNumber,
        p.postalAddress,
        p.totalExperience,
        p.relevantExperience,
        p.jobResponsibilities,
      ]),
    ),
  );

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
