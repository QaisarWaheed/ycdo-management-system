/** Payroll deduction rows of an entry start with this, then `<entryId>] `. */
export const MEDICINE_PENDING_PREFIX = 'Medicine pending [';

export function medicinePendingDescription(entry: {
  id: string;
  tokenNo: string;
  pendingDate: Date;
}) {
  const day = entry.pendingDate.toISOString().slice(0, 10);
  return `${MEDICINE_PENDING_PREFIX}${entry.id}] Token ${entry.tokenNo}, ${day}`;
}
