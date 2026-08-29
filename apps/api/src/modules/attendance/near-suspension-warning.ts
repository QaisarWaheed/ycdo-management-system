import { LetterStatus, LetterType, Prisma } from '@prisma/client';
import type { LettersService } from '../letters/letters.service';
import type { SuspensionWatchlistEntry } from './suspension-watchlist';

export type NearWarningViolationRow = {
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
 * Only Near-contributing reasons (LATE_NEAR, UA_NEAR). Due employees are
 * not on the near list; LATE_DUE / UA_DUE are never rendered here.
 */
export function buildNearWarningViolationRows(
  entry: Pick<
    SuspensionWatchlistEntry,
    | 'reasons'
    | 'lateDays'
    | 'uninformedAbsentDays'
    | 'lateDates'
    | 'uninformedAbsentDates'
  >,
  monthLabel: string,
): NearWarningViolationRow[] {
  const rows: NearWarningViolationRow[] = [];

  if (entry.reasons.includes('LATE_NEAR') && entry.lateDays > 0) {
    rows.push({
      serial: rows.length + 1,
      nameUr: 'تاخیر از حاضری',
      count: entry.lateDays,
      dates: formatDateList(entry.lateDates),
      detail: `ماہ ${monthLabel} — ${entry.lateDays} یوم`,
    });
  }

  if (entry.reasons.includes('UA_NEAR') && entry.uninformedAbsentDays > 0) {
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

export function warningPeriodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function letterPeriod(
  variables: unknown,
  content: unknown,
): string | null {
  const fromVars =
    variables && typeof variables === 'object' && !Array.isArray(variables)
      ? String(
          (variables as Record<string, unknown>).warningPeriod ?? '',
        ).trim()
      : '';
  if (fromVars) return fromVars;
  const fromContent =
    content && typeof content === 'object' && !Array.isArray(content)
      ? String(
          (content as Record<string, unknown>).warningPeriod ?? '',
        ).trim()
      : '';
  return fromContent || null;
}

type NearWarningDb = {
  letter: {
    findMany: Prisma.TransactionClient['letter']['findMany'];
  };
};

export async function issueNearSuspensionWarnings(opts: {
  prisma: NearWarningDb;
  lettersService: Pick<LettersService, 'generateSystemLetter'>;
  near: SuspensionWatchlistEntry[];
  year: number;
  month: number;
}): Promise<{ issued: number; skipped: number }> {
  const period = warningPeriodKey(opts.year, opts.month);
  if (opts.near.length === 0) {
    return { issued: 0, skipped: 0 };
  }

  const existing = await opts.prisma.letter.findMany({
    where: {
      employeeId: { in: opts.near.map((e) => e.employeeId) },
      letterType: LetterType.NEAR_SUSPENSION_WARNING,
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

  for (const entry of opts.near) {
    if (already.has(entry.employeeId)) {
      skipped += 1;
      continue;
    }

    const violationRows = buildNearWarningViolationRows(entry, period);
    if (violationRows.length === 0) {
      skipped += 1;
      continue;
    }

    try {
      await opts.lettersService.generateSystemLetter(
        {
          employeeId: entry.employeeId,
          letterType: LetterType.NEAR_SUSPENSION_WARNING,
          extraFields: {
            warningPeriod: period,
            disciplineCategory: 'NEAR_SUSPENSION_WARNING',
            subject: 'مسلسل خلاف ورزیوں بابت تنبیہی نوٹس',
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
