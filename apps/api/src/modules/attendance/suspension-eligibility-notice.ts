import { LetterStatus, LetterType, Prisma } from '@prisma/client';
import type { LettersService } from '../letters/letters.service';
import type { SuspensionWatchlistEntry } from './suspension-watchlist';

export type EligibilityViolationRow = {
  serial: number;
  nameUr: string;
  count: number;
  dates: string;
  detail: string;
};

function formatDayKey(isoDay: string): string {
  const [y, m, d] = isoDay.split('-');
  if (!y || !m || !d) return isoDay;
  return `${d}/${m}/${y}`;
}

function formatDateList(days: string[]): string {
  return days.map(formatDayKey).join('، ');
}

/**
 * Only Due-contributing reasons (LATE_DUE, UA_DUE). Near reasons on a Due
 * employee (e.g. 7 lates + 3 UA) are omitted. Missing checkout is not a
 * watchlist Due input today, so it is never invented here.
 */
export function buildEligibilityViolationRows(
  entry: Pick<
    SuspensionWatchlistEntry,
    | 'reasons'
    | 'lateDays'
    | 'uninformedAbsentDays'
    | 'lateDates'
    | 'uninformedAbsentDates'
  >,
  monthLabel: string,
): EligibilityViolationRow[] {
  const rows: EligibilityViolationRow[] = [];

  if (entry.reasons.includes('LATE_DUE') && entry.lateDays > 0) {
    rows.push({
      serial: rows.length + 1,
      nameUr: 'تاخیر از حاضری',
      count: entry.lateDays,
      dates: formatDateList(entry.lateDates),
      detail: `ماہ ${monthLabel} — ${entry.lateDays} یوم`,
    });
  }

  if (entry.reasons.includes('UA_DUE') && entry.uninformedAbsentDays > 0) {
    rows.push({
      serial: rows.length + 1,
      nameUr: 'بلا اطلاع غیر حاضری',
      count: entry.uninformedAbsentDays,
      dates: formatDateList(entry.uninformedAbsentDates),
      detail: `ماہ ${monthLabel} — ${entry.uninformedAbsentDays} یوم`,
    });
  }

  return rows;
}

export function eligibilityPeriodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function letterPeriod(
  variables: unknown,
  content: unknown,
): string | null {
  const fromVars =
    variables && typeof variables === 'object' && !Array.isArray(variables)
      ? String(
          (variables as Record<string, unknown>).eligibilityPeriod ?? '',
        ).trim()
      : '';
  if (fromVars) return fromVars;
  const fromContent =
    content && typeof content === 'object' && !Array.isArray(content)
      ? String(
          (content as Record<string, unknown>).eligibilityPeriod ?? '',
        ).trim()
      : '';
  return fromContent || null;
}

type EligibilityDb = {
  letter: {
    findMany: Prisma.TransactionClient['letter']['findMany'];
  };
};

export async function issueDueSuspensionEligibilityNotices(opts: {
  prisma: EligibilityDb;
  lettersService: Pick<LettersService, 'generateSystemLetter'>;
  due: SuspensionWatchlistEntry[];
  year: number;
  month: number;
}): Promise<{ issued: number; skipped: number }> {
  const period = eligibilityPeriodKey(opts.year, opts.month);
  if (opts.due.length === 0) {
    return { issued: 0, skipped: 0 };
  }

  const existing = await opts.prisma.letter.findMany({
    where: {
      employeeId: { in: opts.due.map((e) => e.employeeId) },
      letterType: LetterType.SUSPENSION_ELIGIBILITY,
      status: { not: LetterStatus.REVERSED },
    },
    select: {
      employeeId: true,
      variables: true,
      content: true,
    },
  });

  const already = new Set(
    existing
      .filter((row) => letterPeriod(row.variables, row.content) === period)
      .map((row) => row.employeeId),
  );

  let issued = 0;
  let skipped = 0;

  for (const entry of opts.due) {
    if (already.has(entry.employeeId)) {
      skipped += 1;
      continue;
    }

    const violationRows = buildEligibilityViolationRows(entry, period);
    if (violationRows.length === 0) {
      skipped += 1;
      continue;
    }

    try {
      await opts.lettersService.generateSystemLetter(
        {
          employeeId: entry.employeeId,
          letterType: LetterType.SUSPENSION_ELIGIBILITY,
          extraFields: {
            eligibilityPeriod: period,
            disciplineCategory: 'SUSPENSION_ELIGIBILITY',
            subject: 'اہلیت برائے معطلی بابت مسلسل خلاف ورزیاں',
            violationRows,
            lateDays: entry.lateDays,
            uninformedAbsentDays: entry.uninformedAbsentDays,
            watchlistReasons: entry.reasons,
          },
        },
        'SYSTEM',
      );
      already.add(entry.employeeId);
      issued += 1;
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: string }).code)
          : '';
      if (code === 'P2002') {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }

  return { issued, skipped };
}
