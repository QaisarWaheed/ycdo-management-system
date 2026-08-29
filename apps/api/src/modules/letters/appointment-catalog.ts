import { AppointmentLetterLanguage } from '@prisma/client';
import { DEPARTMENT_DESIGNATIONS } from '../../common/org-structure';
import {
  APPOINTMENT_TEMPLATE_CODES,
  UNMAPPED_APPOINTMENT_DESIGNATIONS,
  appointmentTemplateLanguage,
  type AppointmentTemplateCode,
} from './appointment-families';

export type AppointmentMappingSpec = {
  department: string;
  aliases?: string[];
  titles: string[];
  templateCode: AppointmentTemplateCode;
};

function uniqueTitles(...groups: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const title of group ?? []) {
      const t = title.trim().toUpperCase();
      if (!t || seen.has(t) || UNMAPPED_APPOINTMENT_DESIGNATIONS.has(t)) {
        continue;
      }
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function allTitles(department: string, extras: string[] = []): string[] {
  return uniqueTitles(DEPARTMENT_DESIGNATIONS[department], extras);
}

/** Exact Department + Designation rows seeded in Phase 3B. No global fallback. */
export const APPOINTMENT_MAPPING_SPECS: AppointmentMappingSpec[] = [
  {
    department: 'ACCOUNTS',
    titles: allTitles('ACCOUNTS', ['ACCOUNTS ASSISTANT', 'CENTRAL ACCOUNTANT']),
    templateCode: 'APPT_ADMIN_FINANCE_EN',
  },
  {
    department: 'ADMIN',
    titles: allTitles('ADMIN', ['BRANCH ADMIN']),
    templateCode: 'APPT_ADMIN_FINANCE_EN',
  },
  {
    department: 'HUMAN RESOURCES',
    titles: allTitles('HUMAN RESOURCES'),
    templateCode: 'APPT_ADMIN_FINANCE_EN',
  },
  {
    department: 'COORDINATOR',
    titles: ['PROJECTS COORDINATOR'],
    templateCode: 'APPT_ADMIN_FINANCE_EN',
  },
  {
    department: 'CONSULTANT',
    titles: allTitles('CONSULTANT', [
      'DENTAL SURGEON',
      'PEDIATRICIAN',
      'PHYSICIAN',
    ]),
    templateCode: 'APPT_MEDICAL_CONSULTANT_EN',
  },
  {
    department: 'OPD',
    titles: ['DOCTOR', 'MEDICAL OFFICER', 'WOMAN MEDICAL OFFICER', 'SONOLOGIST'],
    templateCode: 'APPT_MEDICAL_CLINICAL_EN',
  },
  {
    department: 'OPD',
    titles: ['LHV', 'OPD STAFF'],
    templateCode: 'APPT_CLINICAL_SUPPORT_UR',
  },
  {
    department: 'ASSISTANT',
    titles: allTitles('ASSISTANT', ['GYNECOLOGY ASSISTANT']),
    templateCode: 'APPT_CLINICAL_SUPPORT_UR',
  },
  {
    department: 'INDOOR',
    titles: allTitles('INDOOR'),
    templateCode: 'APPT_CLINICAL_SUPPORT_UR',
  },
  {
    department: 'PHARMACY',
    titles: ['PHARMACY INCHARGE', 'AUDIT OFFICER'],
    templateCode: 'APPT_PHARMACY_EN',
  },
  {
    department: 'PHARMACY',
    titles: ['PHARMACY STAFF', 'RECEPTION', 'RECEPTIONIST', 'EMERGENCY STAFF'],
    templateCode: 'APPT_PHARMACY_SUPPORT_UR',
  },
  {
    department: 'LABORATORY',
    titles: ['LAB INCHARGE'],
    templateCode: 'APPT_LAB_EN',
  },
  {
    department: 'LABORATORY',
    titles: ['LAB STAFF', 'LAB STORE ASSISTANT'],
    templateCode: 'APPT_LAB_SUPPORT_UR',
  },
  {
    department: 'LABORATORY MANAGEMENT SYSTEM',
    titles: ['LAB OPERATION MANAGER', 'LAB STORE MANAGER'],
    templateCode: 'APPT_LAB_MANAGEMENT_EN',
  },
  {
    department: 'LABORATORY MANAGEMENT SYSTEM',
    titles: ['RIDER'],
    templateCode: 'APPT_SUPPORT_UR',
  },
  {
    department: 'MEDICINE MANAGEMENT SYSTEM',
    titles: [
      'AUDIT OFFICER',
      'DISPERSAL MANAGER',
      'MEDICINE OPERATIONAL MANGER',
      'MEDICINE STORE MANAGER',
    ],
    templateCode: 'APPT_MEDICINE_MANAGEMENT_EN',
  },
  {
    department: 'MEDICINE MANAGEMENT SYSTEM',
    titles: ['ASSISTANT DISPERSAL', 'ASSISTANT STORE MANAGER'],
    templateCode: 'APPT_MEDICINE_SUPPORT_UR',
  },
  {
    department: 'RADIOLOGY DEPARTMENT',
    // Seed alias only if a legacy RADIOLOGISTS department row still exists.
    // Canonical active department name is RADIOLOGY DEPARTMENT.
    aliases: ['RADIOLOGISTS'],
    titles: ['CONSULTANT RADIOLOGIST', 'RADIOGRAPHER', 'RADIOGRAPHY', 'SONOLOGIST'],
    templateCode: 'APPT_RADIOLOGY_EN',
  },
  {
    department: 'SURGICAL DEPARTMENT',
    titles: ['SURGEON', 'SURGICAL INCHARGE', 'SURGICAL MANAGER'],
    templateCode: 'APPT_SURGICAL_EN',
  },
  {
    department: 'SURGICAL DEPARTMENT',
    titles: [
      'OPERATION THEATER ASSISTANT',
      'OPPERATION THEATER TECHNICIAN',
      'OPERATION THEATER TECHNICIAN',
    ],
    templateCode: 'APPT_SURGICAL_SUPPORT_UR',
  },
  {
    department: 'IT',
    titles: allTitles('IT'),
    templateCode: 'APPT_IT_SOFTWARE_EN',
  },
  {
    department: 'SOFTWARE DEPARTMENT',
    titles: allTitles('SOFTWARE DEPARTMENT'),
    templateCode: 'APPT_IT_SOFTWARE_EN',
  },
  {
    department: 'MEDIA & NEWS',
    titles: allTitles('MEDIA & NEWS', ['EDITER']),
    templateCode: 'APPT_MEDIA_EN',
  },
  {
    department: 'REPAIR AND DEVELOPMENT',
    titles: ['BIO MEDICAL ENGINEERS', 'R&D COORDINATOR', 'COORDINATOR INCHARGE'],
    templateCode: 'APPT_TECHNICAL_EN',
  },
  {
    department: 'REPAIR AND DEVELOPMENT',
    titles: ['ELECTRICIAN', 'CARPENTER', 'PLUMBER', 'R&D SUPERVISOR', 'SUPERVISOR'],
    templateCode: 'APPT_TECHNICAL_SUPPORT_UR',
  },
  {
    department: 'GRADE 4',
    titles: allTitles('GRADE 4', ['LIFT OPERATOR', 'LOADER']),
    templateCode: 'APPT_SUPPORT_UR',
  },
  {
    department: 'SANITARY',
    titles: allTitles('SANITARY'),
    templateCode: 'APPT_SUPPORT_UR',
  },
  {
    department: 'KITCHEN',
    titles: allTitles('KITCHEN', ['KITCHEN STAFF']),
    templateCode: 'APPT_SUPPORT_UR',
  },
  {
    department: 'VTI',
    titles: allTitles('VTI', ['BEAUTICIAN', 'STITCHING WORKER']),
    templateCode: 'APPT_VTI_UR',
  },
  {
    department: 'TEACHER',
    titles: allTitles('TEACHER'),
    templateCode: 'APPT_VTI_UR',
  },
  {
    department: 'PRINCIPAL',
    titles: allTitles('PRINCIPAL'),
    templateCode: 'APPT_VTI_UR',
  },
];

function normalizeDeptKey(name: string): string {
  const n = name.trim().replace(/\s+/g, ' ').toUpperCase();
  if (n === 'RADIOLOGISTS') return 'RADIOLOGY DEPARTMENT';
  if (n === 'SURGICAL  DEPARTMENT') return 'SURGICAL DEPARTMENT';
  return n;
}

const CATALOG = new Map<string, Map<string, AppointmentTemplateCode>>();

for (const spec of APPOINTMENT_MAPPING_SPECS) {
  const keys = [spec.department, ...(spec.aliases ?? [])].map(normalizeDeptKey);
  for (const key of keys) {
    let titles = CATALOG.get(key);
    if (!titles) {
      titles = new Map();
      CATALOG.set(key, titles);
    }
    for (const title of spec.titles) {
      titles.set(title, spec.templateCode);
    }
  }
}

export function lookupAppointmentCatalog(
  departmentName: string,
  designationTitle: string,
): {
  templateCode: AppointmentTemplateCode;
  language: AppointmentLetterLanguage;
} | null {
  const title = designationTitle.trim().toUpperCase();
  if (!title || UNMAPPED_APPOINTMENT_DESIGNATIONS.has(title)) return null;
  const dept = normalizeDeptKey(departmentName);
  const code = CATALOG.get(dept)?.get(title);
  if (!code) return null;
  return {
    templateCode: code,
    language: appointmentTemplateLanguage(code)!,
  };
}

export function flattenAppointmentCatalogRows(): Array<{
  department: string;
  designation: string;
  templateCode: AppointmentTemplateCode;
}> {
  const rows: Array<{
    department: string;
    designation: string;
    templateCode: AppointmentTemplateCode;
  }> = [];
  for (const spec of APPOINTMENT_MAPPING_SPECS) {
    for (const title of spec.titles) {
      rows.push({
        department: spec.department,
        designation: title,
        templateCode: spec.templateCode,
      });
    }
  }
  return rows;
}

export function assertAppointmentCatalogCoversFamilies() {
  const used = new Set(APPOINTMENT_MAPPING_SPECS.map((s) => s.templateCode));
  return APPOINTMENT_TEMPLATE_CODES.filter((code) => !used.has(code));
}
