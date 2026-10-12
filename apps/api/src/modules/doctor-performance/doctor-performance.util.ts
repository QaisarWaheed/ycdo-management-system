/**
 * Which designations count as doctors for the monthly performance sheet,
 * by Designation.category (spaces collapsed, case ignored). A category maps
 * to `true` (every title in it) or to the titles that are doctors.
 */
const DOCTOR_CATEGORIES: Record<string, true | string[]> = {
  CONSULTANT: true,
  OPD: [
    'DOCTOR',
    'MEDICAL OFFICER',
    'WOMAN MEDICAL OFFICER',
    'ANESTHETIC PHYSICIAN',
  ],
  'SURGICAL DEPARTMENT': ['SURGEON', 'ANESTHETIC'],
  'RADIOLOGY DEPARTMENT': ['SONOLOGIST', 'CONSULTANT RADIOLOGIST'],
  REDIALOGISTICS: ['CONSULTANT REDIALOGIST'],
};

const norm = (s: string | null | undefined) =>
  (s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

export function isDoctorDesignation(title: string, category: string): boolean {
  const rule = DOCTOR_CATEGORIES[norm(category)];
  if (!rule) return false;
  return rule === true || rule.includes(norm(title));
}

export type PerformanceFigures = {
  opdPatients: number;
  indoorPatients: number;
  surgeries: number;
  labTests: number;
  /** Lab / diagnostic collection (PKR). */
  labCollection: number;
  collection: number;
};

export const FIGURE_KEYS: Array<keyof PerformanceFigures> = [
  'opdPatients',
  'indoorPatients',
  'surgeries',
  'labTests',
  'labCollection',
  'collection',
];

/** Previous calendar month. */
export function previousMonth(year: number, month: number) {
  return month === 1
    ? { year: year - 1, month: 12 }
    : { year, month: month - 1 };
}
