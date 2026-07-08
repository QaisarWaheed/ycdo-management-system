const hierarchyOrder: Record<string, number> = {
  // Level 1 — Top Management
  'Admin Manager': 1,
  'Operations Manager': 2,

  // Level 2 — Reception
  Receptionist: 3,
  'Senior Receptionist': 4,
  'Reception Staff': 3,

  // Level 3 — Pharmacy
  Pharmacist: 5,
  'Senior Pharmacist': 5,
  'Pharmacy Staff': 5,
  'Medicine Manager': 5,
  'Medicine Store Manager': 5,
  'Admin Medicine': 5,

  // Level 4 — Doctors
  Doctor: 6,
  Consultant: 6,
  Surgeon: 6,
  Anaesthetics: 6,

  // Level 5 — Medical Officers
  'Medical Officer': 7,
  'Senior Medical Officer': 7,
  'House Officer': 7,
  'Intern Doctor': 7,
  OTA: 7,

  // Level 6 — Women Medical Officers
  'Women Medical Officer': 8,

  // Level 7 — Emergency Staff
  'Emergency Staff': 9,

  // Level 8 — Indoor Staff
  'Indoor Staff': 10,

  // Level 9 — Recovery Staff
  'Recovery Staff': 11,

  // Level 10 — Lab Staff
  'Lab Technician': 12,
  'Senior Lab Technician': 12,
  'Lab Staff': 12,
  'Lab Admin Manager': 12,
  'Lab Operation Manager': 12,
  'Lab Store Manager': 12,
  'X-Ray Technician': 12,
  'Biomedical Engineer': 12,

  // Level 11 — Nursery Staff
  Nurse: 13,
  'Head Nurse': 13,
  'Senior Nurse': 13,
  'Nursing Assistant': 13,
  Midwife: 13,
  'Nursery Staff': 13,

  // Level 12 — Organization Staff
  'Admin Officer': 14,
  'Senior Admin Officer': 14,
  'Central Admin Officer': 14,
  'Assets Manager': 14,
  'Audit Officer': 14,
  'Progress Officer': 14,
  'Coordinator Projects': 14,
  'R&D Coordinator': 14,

  // Level 13 — Office Staff
  'Data Entry Operator': 15,
  'Office Assistant': 15,
  'Store Keeper': 15,
  Cashier: 15,
  'Accountant/Chief Finance Officer': 15,
  'Assistant Accountant': 15,
  'Finance Representative': 15,
  'Finance Manager': 15,

  // Level 14 — Repair & Development
  Dispenser: 16,
  Physiotherapist: 16,
  Radiologist: 16,

  // Level 15 — VTI Staff
  'Vocational Trainer': 17,
  'Training Coordinator': 17,
  'VTI Admin Officer': 17,
  'VTI Manager': 17,

  // Level 16 — Kitchen Staff
  Cook: 18,
  'Kitchen Admin Manager': 18,
  'Kitchen Operation Manager': 18,

  // Level 17 — Media House
  'Social Media Officer': 19,
  'Graphic Designer': 19,
  'Media Officer': 19,
  'Content Creator': 19,

  // Level 18 — IT Staff
  'Software Engineer': 20,
  'IT Officer': 20,

  // Level 19 — Support (bottom)
  Housekeeper: 21,
  'Security Guard': 21,
  Driver: 21,
  Helper: 21,
  'Sanitation Worker': 21,
  Sweeper: 21,
};

export { hierarchyOrder };

export function getHierarchyPriority(
  designation: string | null | undefined,
): number {
  if (!designation) return 99;

  if (hierarchyOrder[designation] !== undefined) {
    return hierarchyOrder[designation];
  }

  for (const [key, priority] of Object.entries(hierarchyOrder)) {
    if (designation.toLowerCase().includes(key.toLowerCase())) {
      return priority;
    }
  }

  return 99;
}

export function sortByEmployeeHierarchy<
  T extends { currentDesignation: string | null; fullName: string },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aPriority = getHierarchyPriority(a.currentDesignation);
    const bPriority = getHierarchyPriority(b.currentDesignation);
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.fullName.localeCompare(b.fullName);
  });
}
