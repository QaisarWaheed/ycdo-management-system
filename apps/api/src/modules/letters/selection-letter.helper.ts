import Handlebars from 'handlebars';
import { Gender } from '@prisma/client';
import { formatDuty12h } from '../../common/duty.util';
import { YCDO_LOGO_DATA_URI } from './ycdo-logo-base64';

export type SelectionLetterVariables = Record<string, string | boolean | undefined>;

export function salutationFromGender(gender?: Gender | null): string {
  if (gender === Gender.MALE) return 'Mr.';
  if (gender === Gender.FEMALE) return 'Ms.';
  return 'Mr./Ms.';
}

export function formatIssueDatePkt(date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

/** Urdu long date for letter body, e.g. ۱۵ اگست ۲۰۲۶ء */
export function formatIssueDateUrdu(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(date);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  const day = get('day');
  const month = get('month');
  const year = get('year');

  const monthsUrdu = [
    '',
    'جنوری',
    'فروری',
    'مارچ',
    'اپریل',
    'مئی',
    'جون',
    'جولائی',
    'اگست',
    'ستمبر',
    'اکتوبر',
    'نومبر',
    'دسمبر',
  ];

  const toEastern = (n: number) =>
    String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

  return `${toEastern(day)} ${monthsUrdu[month] ?? ''} ${toEastern(year)}ء`;
}

export function pktYear(date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
    }).format(date),
  );
}

export function renderHandlebarsTemplate(
  bodyHtml: string,
  variables: SelectionLetterVariables,
): string {
  const compiled = Handlebars.compile(bodyHtml, { noEscape: false });
  return compiled(variables);
}

export function buildOrgVariables(): SelectionLetterVariables {
  return {
    letterheadLogoUrl: process.env.LETTERHEAD_LOGO_URL || YCDO_LOGO_DATA_URI,
    orgAddress: process.env.ORG_ADDRESS || '',
    orgPhone: process.env.ORG_PHONE || '',
    orgEmail: process.env.ORG_EMAIL || '',
    founderSignatureUrl: process.env.FOUNDER_SIGNATURE_URL || '',
  };
}

export function scheduleFromDuty(emp: {
  dutyStartTime?: string | null;
  dutyEndTime?: string | null;
}): { scheduleFrom: string; scheduleTo: string } {
  return {
    scheduleFrom: emp.dutyStartTime
      ? formatDuty12h(emp.dutyStartTime)
      : '',
    scheduleTo: emp.dutyEndTime ? formatDuty12h(emp.dutyEndTime) : '',
  };
}

/** Fields required by the SELECTION_LETTER / Appointment template. */
export function appointmentExtraFieldsFromEmployee(
  emp: {
    dutyTotalHours?: number | string | null;
    shift?: { name?: string | null } | null;
  },
  stipendAmount: number | string,
  capacity = 'Full Time',
): Record<string, string> {
  const hoursNum = Number(emp.dutyTotalHours);
  const hoursPerDay =
    Number.isFinite(hoursNum) && hoursNum > 0 ? String(hoursNum) : '8';

  return {
    stipendAmount: String(stipendAmount),
    hoursPerDay,
    shiftName: emp.shift?.name?.trim() || 'General',
    capacity,
  };
}
