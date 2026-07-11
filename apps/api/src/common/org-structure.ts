/** Hospital branch departments (ALL CAPS). */
export const HOSPITAL_DEPARTMENTS = [
  'OPD',
  'INDOOR',
  'ADMIN',
  'PHARMACY',
  'CONSULTANT',
  'MEDICINE MANAGEMENT SYSTEM',
  'LABORATORY MANAGEMENT SYSTEM',
  'LABORATORY',
  'SERGICAL DEPARTMENT',
  'ASSISTANT',
  'GRADE 4',
  'REDIALOGISTICS',
] as const;

export const KITCHEN_DEPARTMENTS = ['KITCHEN'] as const;

export const MEDIA_HOUSE_DEPARTMENTS = [
  'SOFTWARE DEPARTMENT',
  'MEDIA & NEWS',
  'IT',
] as const;

export const VTI_DEPARTMENTS = [
  'TEACHER',
  'PRINCIPAL',
  'VTI',
  'ADMIN',
  'SANITARY',
  'REPAIR AND DEVELOPMENT',
] as const;

export const HEAD_OFFICE_DEPARTMENTS = ['HUMAN RESOURCES', 'ACCOUNTS'] as const;

type OrgContext = 'HOSPITAL' | 'KITCHEN' | 'MEDIA' | 'VTI' | 'HEAD_OFFICE';

const HOSPITAL_DESIGNATIONS: Record<string, string[]> = {
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
    'NUSERY STAFF',
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
    'ASSISTANT DISPERSAL',
    'AUDIT OFFICER',
    'LAB MEDICINE',
    'ASSISTANT AUDIT OFFICER',
  ],
  'LABORATORY MANAGEMENT SYSTEM': [
    'LAB OPPERATION MANAGER',
    'LHV ADMIN MANAGER',
    'LAB STORE MANAGER',
    'LAB ASSISTANT MANAGER',
  ],
  LABORATORY: ['LAB STAFF', 'LAB INCHARGE'],
  'SERGICAL DEPARTMENT': [
    'OPERATION THEATER ASSISTANT',
    'OPPERATION THEATER TECHNICIAN',
    'SURGEON',
    'ANESTHETIC',
  ],
  ASSISTANT: ['ORTHOPEDIC ASSISTANT', 'DENTAL ASSISTANT'],
  'GRADE 4': ['SWEEPER', 'SECURITY GUARD'],
  REDIALOGISTICS: [
    'REDIOGRAPHY',
    'CONSULTANT REDIALOGIST',
    'MEDICAL IMAGING TECHNOLOGY',
    'SONOLOGIST',
  ],
};

const KITCHEN_DESIGNATIONS: Record<string, string[]> = {
  KITCHEN: ['COOK', 'HELPER', 'KITCHEN INCHARGE', 'TANDOORI'],
};

const MEDIA_HOUSE_DESIGNATIONS: Record<string, string[]> = {
  'SOFTWARE DEPARTMENT': ['SOFTWARE ENGINEER', 'INCHARGE OF IT'],
  'MEDIA & NEWS': [
    'INCHARGE MEDIA',
    'EDITER',
    'CAMERAMAN',
    'SOCIAL MEDIA INCHARGE',
  ],
  IT: ['IT ASSISTANT'],
};

const VTI_DESIGNATIONS: Record<string, string[]> = {
  TEACHER: [
    'BEAUTICIAN TEACHER',
    'STITCHING TEACHER',
    'STITCHING HELPERS',
    'BEAUTICIAN HELPER',
    'ISLAMIC SCHOOL',
  ],
  PRINCIPAL: ['PRINCIPAL'],
  VTI: ['VTI'],
  ADMIN: ['ADMIN OFFICER'],
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
};

const HEAD_OFFICE_DESIGNATIONS: Record<string, string[]> = {
  'HUMAN RESOURCES': [
    'HR MANAGER',
    'HR ADMIN',
    'HR OPPERATION MANAGER',
    'HR ASSISTANT',
    'HR STAFF',
    'PROGRESS OFFICER',
    'GYNAE MANAGER',
    'MONITORING OFFICER',
    'REPORTING OFFICER',
  ],
  ACCOUNTS: [
    'FINANCE REPRESENTATIVE',
    'ACCOUNT ASSISTNAT',
    'ACCOUNT MANAGER',
    'CENTRAL ACCOUNTANT',
  ],
};

/** Shared designation titles that appear under more than one department context. */
const SHARED_DESIGNATION_CATEGORIES: Record<string, string> = {
  'ADMIN OFFICER': 'SHARED:ADMIN_OFFICER',
  HELPER: 'SHARED:HELPER',
  SWEEPER: 'SHARED:SWEEPER',
};

function categoryKey(context: OrgContext, department: string): string {
  if (department === 'ADMIN' && context === 'HOSPITAL') return 'HOSPITAL:ADMIN';
  if (department === 'ADMIN' && context === 'VTI') return 'VTI:ADMIN';
  return department;
}

function departmentsForBranchName(branchName: string): readonly string[] {
  const upper = branchName.toUpperCase();
  if (upper.includes('HEAD OFFICE')) return HEAD_OFFICE_DEPARTMENTS;
  if (upper.includes('SOFTWARE HOUSE')) return MEDIA_HOUSE_DEPARTMENTS;
  if (upper.includes('KITCHEN') || upper.includes('RASHAN')) {
    return KITCHEN_DEPARTMENTS;
  }
  if (upper.includes('VTI')) return VTI_DEPARTMENTS;
  return HOSPITAL_DEPARTMENTS;
}

function designationsForContext(context: OrgContext): Record<string, string[]> {
  switch (context) {
    case 'HOSPITAL':
      return HOSPITAL_DESIGNATIONS;
    case 'KITCHEN':
      return KITCHEN_DESIGNATIONS;
    case 'MEDIA':
      return MEDIA_HOUSE_DESIGNATIONS;
    case 'VTI':
      return VTI_DESIGNATIONS;
    case 'HEAD_OFFICE':
      return HEAD_OFFICE_DESIGNATIONS;
  }
}

function contextForBranchName(branchName: string): OrgContext {
  const upper = branchName.toUpperCase();
  if (upper.includes('HEAD OFFICE')) return 'HEAD_OFFICE';
  if (upper.includes('SOFTWARE HOUSE')) return 'MEDIA';
  if (upper.includes('KITCHEN') || upper.includes('RASHAN')) return 'KITCHEN';
  if (upper.includes('VTI')) return 'VTI';
  return 'HOSPITAL';
}

export function resolveDesignationCategoryKeys(
  departmentName: string,
  branchName?: string,
): string[] {
  const dept = departmentName.trim().toUpperCase();
  if (!dept) return [];

  const context = branchName ? contextForBranchName(branchName) : 'HOSPITAL';
  const key = categoryKey(context, dept);
  const keys = new Set<string>([key]);

  if (dept === 'ADMIN') {
    keys.add('SHARED:ADMIN_OFFICER');
  }
  if (dept === 'KITCHEN' || dept === 'REPAIR AND DEVELOPMENT') {
    keys.add('SHARED:HELPER');
  }
  if (dept === 'GRADE 4' || dept === 'SANITARY') {
    keys.add('SHARED:SWEEPER');
  }

  return [...keys];
}

export function buildDesignationSeedRows(): Array<{
  title: string;
  category: string;
}> {
  const rows: Array<{ title: string; category: string }> = [];
  const seen = new Set<string>();

  const contexts: OrgContext[] = [
    'HOSPITAL',
    'KITCHEN',
    'MEDIA',
    'VTI',
    'HEAD_OFFICE',
  ];

  for (const context of contexts) {
    const map = designationsForContext(context);
    for (const [department, titles] of Object.entries(map)) {
      const cat = categoryKey(context, department);
      for (const title of titles) {
        const shared = SHARED_DESIGNATION_CATEGORIES[title];
        const category = shared ?? cat;
        if (seen.has(title)) continue;
        seen.add(title);
        rows.push({ title, category });
      }
    }
  }

  return rows.sort((a, b) => a.title.localeCompare(b.title));
}

export function getDepartmentsForBranch(branchName: string): string[] {
  return [...departmentsForBranchName(branchName)];
}

export const ALL_ORG_DEPARTMENT_NAMES = [
  ...new Set([
    ...HOSPITAL_DEPARTMENTS,
    ...KITCHEN_DEPARTMENTS,
    ...MEDIA_HOUSE_DEPARTMENTS,
    ...VTI_DEPARTMENTS,
    ...HEAD_OFFICE_DEPARTMENTS,
  ]),
].sort();
