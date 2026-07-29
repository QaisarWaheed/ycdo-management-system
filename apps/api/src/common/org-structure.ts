/**
 * Centralized org structure — departments and designations are global (not per-branch).
 * All names are stored in ALL CAPS.
 */
export const DEPARTMENT_DESIGNATIONS: Record<string, string[]> = {
  OPD: [
    'MEDICAL OFFICER',
    'WOMAN MEDICAL OFFICER',
    'LHV',
    'DOCTOR',
    'OPD STAFF',
  ],
  INDOOR: [
    'EMERGENCY STAFF',
    'RECOVERY STAFF',
    'INJECTION AREA STAFF',
    'NURSERY STAFF',
    'INDOOR STAFF',
  ],
  ADMIN: ['OPERATION MANAGER', 'ADMIN MANAGER', 'ADMIN OFFICER'],
  PHARMACY: ['PHARMACY STAFF', 'PHARMACY INCHARGE', 'RECEPTIONIST'],
  CONSULTANT: [
    'ORTHOPEDIC',
    'PAEDIATRICIAN',
    'PHYSIOTHERAPIST',
    'GYNAECOLOGIST',
    'DENTIST',
    'DERMATOLOGIST',
    'ORTHOMOLOGIST',
    'MEDICAL SPECIALIST',
  ],
  'MEDICINE MANAGEMENT SYSTEM': [
    'MEDICINE MANAGER',
    'ASSISTANT DISPERSAL',
    'AUDIT OFFICER',
    'LAB MEDICINE',
    'ASSISTANT AUDIT OFFICER',
  ],
  'LABORATORY MANAGEMENT SYSTEM': [
    'LAB OPERATION MANAGER',
    'LHV ADMIN MANAGER',
    'LAB STORE MANAGER',
    'LAB ASSISTANT MANAGER',
  ],
  LABORATORY: ['LAB STAFF', 'LAB INCHARGE'],
  'SURGICAL DEPARTMENT': [
    'OPERATION THEATER ASSISTANT',
    'OPERATION THEATER TECHNICIAN',
    'SURGEON',
    'ANESTHETIC',
  ],
  ASSISTANT: ['ORTHOPEDIC ASSISTANT', 'DENTAL ASSISTANT'],
  'GRADE 4': ['SWEEPER', 'SECURITY GUARD'],
  RADIOLOGISTS: [
    'RADIOGRAPHY',
    'CONSULTANT RADIOLOGIST',
    'MEDICAL IMAGING TECHNOLOGY',
    'SONOLOGIST',
  ],
  KITCHEN: ['COOK', 'HELPER', 'KITCHEN INCHARGE', 'TANDOORI'],
  'SOFTWARE DEPARTMENT': ['SOFTWARE ENGINEER', 'INCHARGE OF IT'],
  'MEDIA & NEWS': [
    'INCHARGE MEDIA',
    'EDITOR',
    'CAMERAMAN',
    'SOCIAL MEDIA INCHARGE',
  ],
  IT: ['IT ASSISTANT'],
  TEACHER: [
    'BEAUTICIAN TEACHER',
    'STITCHING TEACHER',
    'STITCHING HELPERS',
    'BEAUTICIAN HELPER',
    'ISLAMIC SCHOOL',
  ],
  PRINCIPAL: ['PRINCIPAL'],
  VTI: ['VTI'],
  SANITARY: ['SWEEPER'],
  'REPAIR AND DEVELOPMENT': [
    'BIO MEDICAL ENGINEERS',
    'COORDINATOR INCHARGE',
    'PLUMBER',
    'CARPENTER',
    'ELECTRICIAN',
    'HELPER',
    'SUPERVISOR',
  ],
  'HUMAN RESOURCES': [
    'HR MANAGER',
    'HR ADMIN',
    'HR OPERATION MANAGER',
    'HR ASSISTANT',
    'HR STAFF',
    'PROGRESS OFFICER',
    'GYNAE MANAGER',
    'MONITORING OFFICER',
    'REPORTING OFFICER',
  ],
  ACCOUNTS: [
    'FINANCE REPRESENTATIVE',
    'ACCOUNT ASSISTANT',
    'ACCOUNT MANAGER',
    'CENTRAL ACCOUNTANT',
  ],
};

export const ALL_DEPARTMENT_NAMES = Object.keys(DEPARTMENT_DESIGNATIONS).sort();

/**
 * Departments that can exist inside each project type. Used to scope the
 * department dropdown once a branch (and therefore a project) is chosen.
 */
export const PROJECT_TYPE_DEPARTMENTS: Record<string, string[]> = {
  HOSPITAL: [
    'OPD',
    'INDOOR',
    'ADMIN',
    'PHARMACY',
    'CONSULTANT',
    'MEDICINE MANAGEMENT SYSTEM',
    'LABORATORY MANAGEMENT SYSTEM',
    'LABORATORY',
    'SURGICAL DEPARTMENT',
    'ASSISTANT',
    'RADIOLOGISTS',
    'GRADE 4',
    'SANITARY',
    'REPAIR AND DEVELOPMENT',
    'HUMAN RESOURCES',
    'ACCOUNTS',
  ],
  VTI: [
    'TEACHER',
    'PRINCIPAL',
    'VTI',
    'ADMIN',
    'GRADE 4',
    'SANITARY',
    'HUMAN RESOURCES',
    'ACCOUNTS',
  ],
  KITCHEN: [
    'KITCHEN',
    'ADMIN',
    'GRADE 4',
    'SANITARY',
    'HUMAN RESOURCES',
    'ACCOUNTS',
  ],
  SOFTWARE_HOUSE: [
    'SOFTWARE DEPARTMENT',
    'IT',
    'MEDIA & NEWS',
    'ADMIN',
    'GRADE 4',
    'SANITARY',
    'HUMAN RESOURCES',
    'ACCOUNTS',
  ],
};

export function getDepartmentsForProjectType(type?: string | null): string[] {
  if (!type) return [];
  return PROJECT_TYPE_DEPARTMENTS[normalizeOrgName(type)] ?? [];
}

/**
 * Manual labour departments where HR is not expected to record academic or
 * job-relevant qualifications.
 */
export const QUALIFICATION_EXEMPT_DEPARTMENTS = new Set([
  'GRADE 4',
  'REPAIR AND DEVELOPMENT',
]);

export function departmentRequiresQualification(name?: string | null): boolean {
  if (!name) return true;
  return !QUALIFICATION_EXEMPT_DEPARTMENTS.has(normalizeOrgName(name));
}

/** Organization-level departments excluded from hospital manager scopes. */
export const ORG_LEVEL_DEPARTMENTS = new Set([
  'HUMAN RESOURCES',
  'ACCOUNTS',
  'SOFTWARE DEPARTMENT',
  'MEDIA & NEWS',
  'IT',
  'TEACHER',
  'PRINCIPAL',
  'VTI',
  'KITCHEN',
]);

export function isHospitalAssignableDepartment(name: string): boolean {
  return !ORG_LEVEL_DEPARTMENTS.has(normalizeOrgName(name));
}

export function normalizeOrgName(name: string): string {
  return name.trim().toUpperCase();
}

export const normalizeDepartmentName = normalizeOrgName;
export const normalizeDesignationName = normalizeOrgName;

export function getDesignationsForDepartment(departmentName: string): string[] {
  return DEPARTMENT_DESIGNATIONS[normalizeDepartmentName(departmentName)] ?? [];
}

export function buildDesignationSeedRows(): Array<{
  title: string;
  category: string;
}> {
  const rows: Array<{ title: string; category: string }> = [];
  const seen = new Set<string>();

  for (const [department, titles] of Object.entries(DEPARTMENT_DESIGNATIONS)) {
    for (const title of titles) {
      if (seen.has(title)) continue;
      seen.add(title);
      rows.push({ title, category: department });
    }
  }

  return rows.sort((a, b) => a.title.localeCompare(b.title));
}

/** @deprecated Use getDesignationsForDepartment — kept for transitional imports */
export function getDepartmentsForBranch(_branchName: string): string[] {
  return [...ALL_DEPARTMENT_NAMES];
}

/** @deprecated Use getDesignationsForDepartment */
export function resolveDesignationCategoryKeys(
  departmentName: string,
  _branchName?: string,
): string[] {
  const titles = getDesignationsForDepartment(departmentName);
  return titles.length > 0 ? [normalizeDepartmentName(departmentName)] : [];
}
