import Handlebars from 'handlebars';
import { Gender } from '@prisma/client';
import { formatDuty12h } from '../../common/duty.util';

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
    letterheadLogoUrl: process.env.LETTERHEAD_LOGO_URL || '',
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
