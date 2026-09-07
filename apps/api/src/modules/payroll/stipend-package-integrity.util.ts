import { BadRequestException } from '@nestjs/common';
import { StipendPackageInput } from '../../common/stipend.util';
const components = ['allowances', 'fuelAllowance', 'reward', 'progressReward', 'loanDeduction', 'advanceDeduction', 'fineDeduction', 'healthDeduction'] as const;

/** Null/omitted optional values preserve the stored amount; zero is intentional. */
export function resolvePackageComponents(existing: Partial<Record<keyof StipendPackageInput, unknown>>, supplied: StipendPackageInput): StipendPackageInput {
  const result: StipendPackageInput = { basicStipend: supplied.basicStipend };
  for (const key of components) result[key] = Number(supplied[key] ?? existing[key] ?? 0);
  return result;
}

/** Validate the proposed half-open timeline before any package writes. */
export function validatePackageTimeline(records: Array<{ id: string; effectiveFrom: Date; effectiveTo: Date | null }>): void {
  const ranges = records.map(r => ({ id: r.id, start: r.effectiveFrom.getTime(), end: r.effectiveTo == null ? Infinity : r.effectiveTo.getTime() }));
  if (ranges.some(r => !Number.isFinite(r.start) || Number.isNaN(r.end) || r.end < r.start)) {
    throw new BadRequestException('Invalid stipend timeline: a package end cannot precede its start');
  }
  const nonempty = ranges.filter(r => r.end > r.start).sort((a,b) => a.start - b.start);
  for (let i = 1; i < nonempty.length; i++) {
    if (nonempty[i].start < nonempty[i-1].end) throw new BadRequestException('Invalid stipend timeline: package ranges overlap; historical correction requires review');
  }
}
