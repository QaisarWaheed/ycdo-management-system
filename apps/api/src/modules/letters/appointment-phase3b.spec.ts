import { readFileSync } from 'fs';
import { join } from 'path';
import { AppointmentLetterLanguage } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import {
  lookupAppointmentCatalog,
  flattenAppointmentCatalogRows,
  APPOINTMENT_MAPPING_SPECS,
} from './appointment-catalog';
import {
  APPOINTMENT_TEMPLATE_CODES,
  resolveAppointmentServiceArea,
  UNMAPPED_APPOINTMENT_DESIGNATIONS,
} from './appointment-families';
import {
  resolveAppointmentDutyTotalHours,
  resolveAppointmentMonthlyAllowedLeaves,
  shortLeaveHoursFromDutyTotalHours,
} from './appointment-policy';
import { appointmentSopHtml } from './appointment-sop';
import { APPOINTMENT_CHAIRMAN_ADMIN_NAME } from './appointment-signatory';
import { renderHandlebarsTemplate } from './selection-letter.helper';
import { applyAppointmentDraftWatermark } from './appointment-watermark';
import { APPOINTMENT_DRAFT_WATERMARK_TEXT } from './appointment-watermark';
import { DEFAULT_MONTHLY_ALLOWED_LEAVES } from '../payroll/payroll-hours.util';
import {
  APPOINTMENT_MAPPING_MISSING_MESSAGE,
  resolveAppointmentTemplateMapping,
} from './appointment-template-mapping';
import { APPOINTMENT_INVALID_ASSIGNMENT_MESSAGE } from './appointment-families';
import { URDU_LETTER_STYLES } from './urdu-letter-styles';

function renderFamily(
  file: string,
  templateCode: string,
  language: AppointmentLetterLanguage,
  extras: Record<string, string> = {},
) {
  const body = readFileSync(
    join(__dirname, '../../../prisma/seeds/templates/letters', file),
    'utf8',
  );
  return renderHandlebarsTemplate(body, {
    letterNo: '1/YCDO/2026',
    issueDate: '29/08/2026',
    salutation: 'Mr.',
    employeeName: 'Test Employee',
    cnic: '12345-1234567-1',
    phone: '03001234567',
    designation: extras.designation ?? 'MEDICAL OFFICER',
    department: extras.department ?? 'OPD',
    branchName: 'Main',
    stipendAmount: '15000',
    dutyTotalHours: extras.dutyTotalHours ?? '8',
    shiftName: 'General',
    scheduleFrom: '09:00 AM',
    scheduleTo: '05:00 PM',
    monthlyAllowedLeaves: extras.monthlyAllowedLeaves ?? '2',
    shortLeaveHours: extras.shortLeaveHours ?? '4',
    serviceArea: resolveAppointmentServiceArea(
      templateCode,
      extras.department ?? 'OPD',
    ),
    departmentSpecificSops: appointmentSopHtml(templateCode, language),
    chairmanAdminName: APPOINTMENT_CHAIRMAN_ADMIN_NAME,
    letterStyles: language === AppointmentLetterLanguage.UR ? URDU_LETTER_STYLES : '',
  });
}

describe('Appointment Phase 3B catalog, policy, and templates', () => {
  it('covers every family code and does not map ADMIN+LAB', () => {
    const used = new Set(APPOINTMENT_MAPPING_SPECS.map((s) => s.templateCode));
    for (const code of APPOINTMENT_TEMPLATE_CODES) {
      expect(used.has(code)).toBe(true);
    }
    expect(UNMAPPED_APPOINTMENT_DESIGNATIONS.has('ADMINISTRATION / ADMIN+LAB')).toBe(
      true,
    );
    expect(
      lookupAppointmentCatalog('ADMIN', 'ADMINISTRATION / ADMIN+LAB'),
    ).toBeNull();
    expect(flattenAppointmentCatalogRows().length).toBeGreaterThan(40);
  });

  it('resolves exact dept+designation to expected families and languages', () => {
    expect(lookupAppointmentCatalog('OPD', 'MEDICAL OFFICER')).toEqual({
      templateCode: 'APPT_MEDICAL_CLINICAL_EN',
      language: AppointmentLetterLanguage.EN,
    });
    expect(lookupAppointmentCatalog('OPD', 'LHV')).toEqual({
      templateCode: 'APPT_CLINICAL_SUPPORT_UR',
      language: AppointmentLetterLanguage.UR,
    });
    expect(lookupAppointmentCatalog('RADIOLOGY DEPARTMENT', 'CONSULTANT RADIOLOGIST')).toEqual({
      templateCode: 'APPT_RADIOLOGY_EN',
      language: AppointmentLetterLanguage.EN,
    });
    expect(lookupAppointmentCatalog('IT', 'IT ASSISTANT')).toEqual({
      templateCode: 'APPT_IT_SOFTWARE_EN',
      language: AppointmentLetterLanguage.EN,
    });
    expect(lookupAppointmentCatalog('VTI', 'VTI')).toEqual({
      templateCode: 'APPT_VTI_UR',
      language: AppointmentLetterLanguage.UR,
    });
    expect(lookupAppointmentCatalog('PHARMACY', 'PHARMACY INCHARGE')?.templateCode).toBe(
      'APPT_PHARMACY_EN',
    );
    expect(lookupAppointmentCatalog('LABORATORY', 'LAB INCHARGE')?.templateCode).toBe(
      'APPT_LAB_EN',
    );
    expect(
      lookupAppointmentCatalog('MEDICINE MANAGEMENT SYSTEM', 'MEDICINE OPERATIONAL MANGER')
        ?.templateCode,
    ).toBe('APPT_MEDICINE_MANAGEMENT_EN');
    expect(
      lookupAppointmentCatalog('SURGICAL DEPARTMENT', 'OPPERATION THEATER TECHNICIAN')
        ?.templateCode,
    ).toBe('APPT_SURGICAL_SUPPORT_UR');
    expect(lookupAppointmentCatalog('OPD', 'UNKNOWN ROLE')).toBeNull();
  });

  it('uses dynamic serviceArea by family and department', () => {
    expect(resolveAppointmentServiceArea('APPT_MEDICAL_CLINICAL_EN', 'OPD')).toBe(
      'Medical Services',
    );
    expect(resolveAppointmentServiceArea('APPT_IT_SOFTWARE_EN', 'IT')).toBe(
      'IT & Software Services',
    );
    expect(resolveAppointmentServiceArea('APPT_VTI_UR', 'VTI')).toBe(
      'Vocational Training Services',
    );
    expect(resolveAppointmentServiceArea('APPT_SUPPORT_UR', 'GRADE 4')).toBe(
      'Support Services',
    );
    expect(resolveAppointmentServiceArea('APPT_ADMIN_FINANCE_EN', 'ACCOUNTS')).toBe(
      'Finance & Accounts Services',
    );
    expect(
      resolveAppointmentServiceArea('APPT_ADMIN_FINANCE_EN', 'HUMAN RESOURCES'),
    ).toBe('Human Resource Services');
    const html = renderFamily('APPT_BASE_EN.hbs', 'APPT_IT_SOFTWARE_EN', AppointmentLetterLanguage.EN, {
      department: 'IT',
      designation: 'IT ASSISTANT',
    });
    expect(html).toContain('IT &amp; Software Services');
    expect(html).not.toMatch(/Volunteer for Medical Services/);
  });

  it('derives monthlyAllowedLeaves from employee data and payroll default', () => {
    expect(
      resolveAppointmentMonthlyAllowedLeaves({
        employeeMonthlyAllowedLeaves: 4,
      }),
    ).toBe(4);
    expect(
      resolveAppointmentMonthlyAllowedLeaves({
        employeeMonthlyAllowedLeaves: 0,
      }),
    ).toBe(0);
    expect(
      resolveAppointmentMonthlyAllowedLeaves({
        employeeMonthlyAllowedLeaves: null,
      }),
    ).toBe(DEFAULT_MONTHLY_ALLOWED_LEAVES);
    const html = renderFamily('APPT_BASE_EN.hbs', 'APPT_MEDICAL_CLINICAL_EN', AppointmentLetterLanguage.EN, {
      monthlyAllowedLeaves: '0',
    });
    expect(html).toContain('0 approved leave(s) per month');
    expect(html).not.toMatch(/four Leaves/i);
  });

  it('sets shortLeaveHours to half of dutyTotalHours', () => {
    expect(shortLeaveHoursFromDutyTotalHours(12)).toBe('6');
    expect(shortLeaveHoursFromDutyTotalHours(8)).toBe('4');
    expect(resolveAppointmentDutyTotalHours({ employeeDutyTotalHours: 10 })).toBe(10);
    expect(shortLeaveHoursFromDutyTotalHours(10)).toBe('5');
    expect(shortLeaveHoursFromDutyTotalHours(9)).toBe('4.5');
  });

  it('renders English policy clauses, signatory, and medical SOP', () => {
    const html = applyAppointmentDraftWatermark(
      renderFamily('APPT_BASE_EN.hbs', 'APPT_MEDICAL_CLINICAL_EN', AppointmentLetterLanguage.EN),
    );
    expect(html).toContain('all official meetings, trainings, events');
    expect(html).toContain('30 days');
    expect(html).toContain('pending dues may be forfeited or adjusted');
    expect(html).toContain('suspension, inquiry, termination');
    expect(html).toContain(APPOINTMENT_CHAIRMAN_ADMIN_NAME);
    expect(html).toContain(APPOINTMENT_DRAFT_WATERMARK_TEXT);
    expect(html).toContain('patient confidentiality');
    expect(html).toContain('Maximum Short Leave Duration: 4 hours');
  });

  it('renders Urdu base with VTI/support SOP families and policy intent', () => {
    const vti = renderFamily('APPT_BASE_UR.hbs', 'APPT_VTI_UR', AppointmentLetterLanguage.UR, {
      department: 'VTI',
      designation: 'VTI',
      dutyTotalHours: '8',
      shortLeaveHours: '4',
    });
    expect(vti).toContain('تیس (30) دن');
    expect(vti).toContain('Short Leave');
    expect(vti).toContain('ضبط یا ایڈجسٹ');
    expect(vti).toContain('Suspension');
    expect(vti).toContain('Termination');
    expect(vti).toContain('تربیت یافتگان');
    expect(vti).toContain(APPOINTMENT_CHAIRMAN_ADMIN_NAME);

    const support = renderFamily('APPT_BASE_UR.hbs', 'APPT_SUPPORT_UR', AppointmentLetterLanguage.UR, {
      department: 'GRADE 4',
      designation: 'SWEEPER',
    });
    expect(support).toContain('حفظانِ صحت');

    const pharmacy = renderFamily(
      'APPT_BASE_EN.hbs',
      'APPT_PHARMACY_EN',
      AppointmentLetterLanguage.EN,
      { department: 'PHARMACY', designation: 'PHARMACY INCHARGE' },
    );
    expect(pharmacy).toContain('medicine issue, receipt, stock');

    const lab = renderFamily('APPT_BASE_EN.hbs', 'APPT_LAB_EN', AppointmentLetterLanguage.EN, {
      department: 'LABORATORY',
      designation: 'LAB INCHARGE',
    });
    expect(lab).toContain('sample, test request, and patient identity');

    const it = renderFamily('APPT_BASE_EN.hbs', 'APPT_IT_SOFTWARE_EN', AppointmentLetterLanguage.EN, {
      department: 'IT',
      designation: 'IT ASSISTANT',
    });
    expect(it).toContain('passwords, API keys');
  });

  it('fails closed for unmapped roles including ADMIN+LAB even with department fallback', async () => {
    const db = {
      designation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'des-bad' }),
      },
      appointmentTemplateMapping: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'map-dept',
          departmentId: 'dept-admin',
          designationId: null,
          language: AppointmentLetterLanguage.EN,
          templateCode: 'APPT_ADMIN_FINANCE_EN',
        }),
      },
    };
    await expect(
      resolveAppointmentTemplateMapping(db, {
        departmentId: 'dept-admin',
        designationTitle: 'ADMINISTRATION / ADMIN+LAB',
      }),
    ).rejects.toThrow(APPOINTMENT_INVALID_ASSIGNMENT_MESSAGE);

    await expect(
      resolveAppointmentTemplateMapping(
        {
          designation: { findFirst: jest.fn().mockResolvedValue({ id: 'd1' }) },
          appointmentTemplateMapping: { findFirst: jest.fn().mockResolvedValue(null) },
        },
        { departmentId: 'dept-x', designationTitle: 'UNKNOWN' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
