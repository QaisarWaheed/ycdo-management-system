import { LetterType } from '@prisma/client';

export interface LetterData {
  refNumber: string;
  date: string;
  employeeName: string;
  employeeCode: string;
  designation: string;
  department: string;
  branch: string;
  cnic: string;
  joiningDate: string;
  [key: string]: unknown;
}

const baseStyles = `
  body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #000; line-height: 1.6; margin: 0; padding: 0; }
  .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 24px; }
  .hospital-name { font-size: 18pt; font-weight: bold; margin: 0; }
  .hospital-address { font-size: 10pt; margin: 4px 0 0; }
  .ref-line { margin: 16px 0; font-size: 11pt; }
  .meta { margin: 16px 0; }
  .meta p { margin: 4px 0; }
  .subject { font-weight: bold; margin: 20px 0; text-decoration: underline; }
  .body-content { text-align: justify; margin: 16px 0; }
  .body-content p { margin: 12px 0; }
  .footer { margin-top: 48px; border-top: 1px solid #ccc; padding-top: 16px; font-size: 10pt; color: #333; }
  .signature { margin-top: 48px; }
  .signature p { margin: 4px 0; }
`;

function wrapLetter(data: LetterData, subject: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>${baseStyles}</style></head>
<body>
  <div class="header">
    <p class="hospital-name">YCDO Central Hospital</p>
    <p class="hospital-address">Multan, Punjab, Pakistan</p>
  </div>
  <div class="ref-line">
    <strong>Ref:</strong> ${data.refNumber} &nbsp;&nbsp;|&nbsp;&nbsp; <strong>Date:</strong> ${data.date}
  </div>
  <div class="meta">
    <p><strong>To:</strong> ${data.employeeName}</p>
    <p><strong>Employee Code:</strong> ${data.employeeCode} &nbsp;|&nbsp; <strong>CNIC:</strong> ${data.cnic}</p>
    <p><strong>Designation:</strong> ${data.designation}</p>
    <p><strong>Department:</strong> ${data.department} &nbsp;|&nbsp; <strong>Branch:</strong> ${data.branch}</p>
  </div>
  <div class="subject">${subject}</div>
  <div class="body-content">${bodyHtml}</div>
  <div class="signature">
    <p>_________________________</p>
    <p><strong>HR Manager</strong></p>
    <p>YCDO Central Hospital</p>
  </div>
  <div class="footer">Issued by HR Department</div>
</body>
</html>`;
}

function field(data: LetterData, key: string, fallback = 'N/A'): string {
  const value = data[key];
  return value !== undefined && value !== null ? String(value) : fallback;
}

export function generateAppointmentLetter(data: LetterData): string {
  const body = `
    <p>Dear ${data.employeeName},</p>
    <p>We are pleased to confirm your appointment at YCDO Central Hospital. Welcome to our team.</p>
    <p><strong>Appointment Details:</strong></p>
    <ul>
      <li>Joining Date: ${field(data, 'joiningDate')}</li>
      <li>Designation: ${field(data, 'designation')}</li>
      <li>Department: ${field(data, 'department')}</li>
      <li>Branch: ${field(data, 'branch')}</li>
      <li>Basic Stipend: PKR ${field(data, 'basicStipend')}</li>
      <li>Working Hours: ${field(data, 'workingHours', '9:00 AM - 5:00 PM')}</li>
      <li>Probation Period: ${field(data, 'probationPeriod', '3 months')}</li>
    </ul>
    <p><strong>SOP Discipline Policy Summary:</strong></p>
    <ul>
      <li><strong>Late Policy:</strong> Arrival after 9:15 AM is recorded as late. Three late arrivals in a month may result in disciplinary action and salary deduction.</li>
      <li><strong>Leave Policy:</strong> Maximum 24 unpaid leaves per calendar year. Leave requests require prior approval from HR.</li>
    </ul>
    <p>We look forward to your valuable contribution to the hospital.</p>
  `;
  return wrapLetter(data, 'APPOINTMENT LETTER', body);
}

export function generateWarningLetter(data: LetterData): string {
  const body = `
    <p>Dear ${data.employeeName},</p>
    <p>This is a formal <strong>${field(data, 'warningNumber', '1st')} Warning</strong> issued in accordance with the hospital's disciplinary policy.</p>
    <p><strong>Incident Date:</strong> ${field(data, 'incidentDate')}</p>
    <p><strong>Reason:</strong> ${field(data, 'warningReason')}</p>
    <p>You are hereby advised to correct your conduct immediately and adhere to hospital policies and professional standards. Further violations may result in more severe disciplinary action, including fine or suspension.</p>
    <p>We expect improved behavior and full compliance with hospital SOPs going forward.</p>
  `;
  return wrapLetter(data, 'WARNING LETTER', body);
}

export function generateAdviceLetter(data: LetterData): string {
  const body = `
    <p>Dear ${data.employeeName},</p>
    <p>This letter is issued to provide advice and counseling regarding your conduct and performance at YCDO Central Hospital.</p>
    <p><strong>Reason:</strong> ${field(data, 'adviceReason')}</p>
    <p><strong>Details:</strong> ${field(data, 'adviceDetails')}</p>
    <p>You are advised to take this matter seriously and make the necessary improvements. The hospital management expects your cooperation and commitment to professional standards.</p>
  `;
  return wrapLetter(data, 'ADVICE LETTER', body);
}

export function generateDisciplinaryLetter(data: LetterData): string {
  const body = `
    <p>Dear ${data.employeeName},</p>
    <p>Following an investigation into your conduct, disciplinary action is being taken against you.</p>
    <p><strong>Violation Type:</strong> ${field(data, 'violationType')}</p>
    <p><strong>Incident Date:</strong> ${field(data, 'incidentDate')}</p>
    <p><strong>Action Taken:</strong> ${field(data, 'actionTaken')}</p>
    <p>This action has been recorded in your personnel file. Any recurrence of similar misconduct will result in further disciplinary measures as per hospital policy.</p>
  `;
  return wrapLetter(data, 'DISCIPLINARY ACTION LETTER', body);
}

export function generateExplanationLetter(data: LetterData): string {
  const body = `
    <p>Dear ${data.employeeName},</p>
    <p>You are required to submit a written explanation regarding the following matter:</p>
    <p><strong>Issue:</strong> ${field(data, 'issueDescription')}</p>
    <p>Please submit your written explanation to the HR Department no later than <strong>${field(data, 'responseDeadline')}</strong>. Failure to respond within the stipulated time may result in disciplinary action.</p>
  `;
  return wrapLetter(data, 'REQUEST FOR EXPLANATION', body);
}

export function generateShowCauseLetter(data: LetterData): string {
  const body = `
    <p>Dear ${data.employeeName},</p>
    <p>You are hereby served a <strong>Show Cause Notice</strong> to explain why disciplinary action should not be taken against you.</p>
    <p><strong>Allegation:</strong> ${field(data, 'allegation')}</p>
    <p>You are required to submit your written response to the HR Department by <strong>${field(data, 'responseDeadline')}</strong>. If no satisfactory response is received, the management reserves the right to take appropriate action.</p>
  `;
  return wrapLetter(data, 'SHOW CAUSE NOTICE', body);
}

export function generateFineLetter(data: LetterData): string {
  const body = `
    <p>Dear ${data.employeeName},</p>
    <p>A fine has been imposed upon you in accordance with the hospital's disciplinary policy.</p>
    <p><strong>Reason:</strong> ${field(data, 'fineReason')}</p>
    <p><strong>Fine Amount:</strong> PKR ${field(data, 'fineAmount')}</p>
    <p><strong>Deduction Month:</strong> ${field(data, 'deductionMonth')}</p>
    <p>The above amount will be deducted from your salary for the specified month. This decision is final unless overturned through the formal grievance process.</p>
  `;
  return wrapLetter(data, 'FINE NOTICE', body);
}

export function generateInquiryLetter(data: LetterData): string {
  const body = `
    <p>Dear ${data.employeeName},</p>
    <p>An official inquiry is being initiated against you regarding the following matter:</p>
    <p><strong>Reason:</strong> ${field(data, 'inquiryReason')}</p>
    <p><strong>Inquiry Date:</strong> ${field(data, 'inquiryDate')}</p>
    <p><strong>Committee Members:</strong> ${field(data, 'committeeMembers')}</p>
    <p>You are required to appear before the inquiry committee on the specified date and cooperate fully with the proceedings.</p>
  `;
  return wrapLetter(data, 'INQUIRY INITIATION LETTER', body);
}

export function generateAppreciationLetter(data: LetterData): string {
  const body = `
    <p>Dear ${data.employeeName},</p>
    <p>On behalf of YCDO Central Hospital, we would like to express our sincere appreciation for your outstanding performance.</p>
    <p><strong>Reason:</strong> ${field(data, 'appreciationReason')}</p>
    <p><strong>Achievement Details:</strong> ${field(data, 'achievementDetails')}</p>
    <p>Your dedication and professionalism are valued and recognized by the management. We encourage you to continue maintaining these high standards.</p>
  `;
  return wrapLetter(data, 'LETTER OF APPRECIATION', body);
}

export function generateTransferLetter(data: LetterData): string {
  const body = `
    <p>Dear ${data.employeeName},</p>
    <p>You are hereby transferred to a new assignment as detailed below:</p>
    <table style="width:100%; border-collapse:collapse; margin:16px 0;">
      <tr><td style="padding:6px;border:1px solid #ccc;"><strong>From Branch</strong></td><td style="padding:6px;border:1px solid #ccc;">${field(data, 'fromBranch')}</td></tr>
      <tr><td style="padding:6px;border:1px solid #ccc;"><strong>To Branch</strong></td><td style="padding:6px;border:1px solid #ccc;">${field(data, 'toBranch')}</td></tr>
      <tr><td style="padding:6px;border:1px solid #ccc;"><strong>From Department</strong></td><td style="padding:6px;border:1px solid #ccc;">${field(data, 'fromDepartment')}</td></tr>
      <tr><td style="padding:6px;border:1px solid #ccc;"><strong>To Department</strong></td><td style="padding:6px;border:1px solid #ccc;">${field(data, 'toDepartment')}</td></tr>
      <tr><td style="padding:6px;border:1px solid #ccc;"><strong>New Designation</strong></td><td style="padding:6px;border:1px solid #ccc;">${field(data, 'newDesignation')}</td></tr>
      <tr><td style="padding:6px;border:1px solid #ccc;"><strong>Effective Date</strong></td><td style="padding:6px;border:1px solid #ccc;">${field(data, 'effectiveDate')}</td></tr>
    </table>
    <p>Please report to your new assignment on the effective date. This transfer order is effective immediately unless otherwise stated.</p>
  `;
  return wrapLetter(data, 'TRANSFER ORDER', body);
}

export function generateSuspensionLetter(data: LetterData): string {
  const body = `
    <p>Dear ${data.employeeName},</p>
    <p>You are hereby suspended from duty with immediate effect pending further investigation.</p>
    <p><strong>Reason:</strong> ${field(data, 'suspensionReason')}</p>
    <p><strong>Suspension Start Date:</strong> ${field(data, 'suspensionStartDate')}</p>
    <p><strong>Duration:</strong> ${field(data, 'suspensionDuration')}</p>
    <p>During the suspension period, you are not authorized to perform your duties. You must remain available for any inquiry proceedings and report to HR as directed.</p>
  `;
  return wrapLetter(data, 'SUSPENSION NOTICE', body);
}

export function generateTerminationLetter(data: LetterData): string {
  const body = `
    <p>Dear ${data.employeeName},</p>
    <p>We regret to inform you that your employment with YCDO Central Hospital is being terminated.</p>
    <p><strong>Reason:</strong> ${field(data, 'terminationReason')}</p>
    <p><strong>Last Working Day:</strong> ${field(data, 'terminationDate')}</p>
    <p><strong>Settlement Details:</strong> ${field(data, 'settlementDetails')}</p>
    <p>Please complete all handover formalities and return hospital property before your last working day. Final settlement will be processed as per hospital policy.</p>
  `;
  return wrapLetter(data, 'TERMINATION LETTER', body);
}

export function generateReinstatementLetter(data: LetterData): string {
  const body = `
    <p>Dear ${data.employeeName},</p>
    <p>We are pleased to inform you that you have been reinstated to your position at YCDO Central Hospital.</p>
    <p><strong>Reinstatement Date:</strong> ${field(data, 'reinstatementDate')}</p>
    <p><strong>Designation:</strong> ${field(data, 'reinstatedDesignation')}</p>
    <p><strong>Department:</strong> ${field(data, 'reinstatedDepartment')}</p>
    <p>Please resume your duties on the reinstatement date. We expect your full cooperation and adherence to hospital policies.</p>
  `;
  return wrapLetter(data, 'REINSTATEMENT ORDER', body);
}

export function generateRejoiningLetter(data: LetterData): string {
  const body = `
    <p>Dear ${data.employeeName},</p>
    <p>We acknowledge your rejoining of duties at YCDO Central Hospital.</p>
    <p><strong>Rejoining Date:</strong> ${field(data, 'rejoiningDate')}</p>
    <p><strong>Designation:</strong> ${field(data, 'rejoiningDesignation')}</p>
    <p>Please report to your department on the rejoining date. All hospital policies and SOPs remain applicable to your employment.</p>
  `;
  return wrapLetter(data, 'REJOINING LETTER', body);
}

export function generateSalaryIncrementLetter(data: LetterData): string {
  const body = `
    <p>Dear ${data.employeeName},</p>
    <p>We are pleased to inform you that your salary has been revised as follows:</p>
    <table style="width:100%; border-collapse:collapse; margin:16px 0;">
      <tr><td style="padding:6px;border:1px solid #ccc;"><strong>Previous Salary</strong></td><td style="padding:6px;border:1px solid #ccc;">PKR ${field(data, 'previousSalary')}</td></tr>
      <tr><td style="padding:6px;border:1px solid #ccc;"><strong>New Salary</strong></td><td style="padding:6px;border:1px solid #ccc;">PKR ${field(data, 'newSalary')}</td></tr>
      <tr><td style="padding:6px;border:1px solid #ccc;"><strong>Increment Amount</strong></td><td style="padding:6px;border:1px solid #ccc;">PKR ${field(data, 'incrementAmount')}</td></tr>
      <tr><td style="padding:6px;border:1px solid #ccc;"><strong>Effective Date</strong></td><td style="padding:6px;border:1px solid #ccc;">${field(data, 'effectiveDate')}</td></tr>
    </table>
    <p><strong>Reason:</strong> ${field(data, 'incrementReason')}</p>
    <p>We appreciate your continued dedication and contribution to the hospital.</p>
  `;
  return wrapLetter(data, 'SALARY INCREMENT LETTER', body);
}

export function generateExperienceLetter(data: LetterData): string {
  const body = `
    <p><strong>To Whom It May Concern,</strong></p>
    <p>This is to certify that <strong>${data.employeeName}</strong> (CNIC: ${data.cnic}, Employee Code: ${data.employeeCode}) was employed at YCDO Central Hospital.</p>
    <p><strong>Designation:</strong> ${data.designation}</p>
    <p><strong>Department:</strong> ${data.department}</p>
    <p><strong>Branch:</strong> ${data.branch}</p>
    <p><strong>Joining Date:</strong> ${data.joiningDate}</p>
    <p><strong>Last Working Date:</strong> ${field(data, 'lastWorkingDate')}</p>
    <p><strong>Total Experience:</strong> ${field(data, 'totalExperience')}</p>
    <p><strong>Job Description:</strong> ${field(data, 'jobDescription')}</p>
    <p>During the tenure, ${data.employeeName} performed duties satisfactorily. We wish them success in future endeavors.</p>
  `;
  return wrapLetter(data, 'EXPERIENCE / SERVICE CERTIFICATE', body);
}

const LETTER_TYPE_SHORT: Record<LetterType, string> = {
  APPOINTMENT: 'APT',
  WARNING: 'WRN',
  ADVICE: 'ADV',
  DISCIPLINARY: 'DSC',
  EXPLANATION: 'EXP',
  SHOW_CAUSE: 'SCN',
  FINE: 'FNE',
  INQUIRY: 'INQ',
  APPRECIATION: 'APR',
  TRANSFER: 'TRF',
  SUSPENSION: 'SUS',
  TERMINATION: 'TRM',
  REINSTATEMENT: 'RST',
  REJOINING: 'RJN',
  SALARY_INCREMENT: 'INC',
  EXPERIENCE: 'EXL',
};

export const TEMPLATE_GENERATORS: Record<
  LetterType,
  (data: LetterData) => string
> = {
  APPOINTMENT: generateAppointmentLetter,
  WARNING: generateWarningLetter,
  ADVICE: generateAdviceLetter,
  DISCIPLINARY: generateDisciplinaryLetter,
  EXPLANATION: generateExplanationLetter,
  SHOW_CAUSE: generateShowCauseLetter,
  FINE: generateFineLetter,
  INQUIRY: generateInquiryLetter,
  APPRECIATION: generateAppreciationLetter,
  TRANSFER: generateTransferLetter,
  SUSPENSION: generateSuspensionLetter,
  TERMINATION: generateTerminationLetter,
  REINSTATEMENT: generateReinstatementLetter,
  REJOINING: generateRejoiningLetter,
  SALARY_INCREMENT: generateSalaryIncrementLetter,
  EXPERIENCE: generateExperienceLetter,
};

export function getLetterTypeShort(letterType: LetterType): string {
  return LETTER_TYPE_SHORT[letterType];
}

export function sanitizeRefForFilename(refNumber: string): string {
  return refNumber.replace(/\//g, '-');
}
