import {
  appendComputerGeneratedNotice,
  applyFineUniformWording,
  buildLetterRef,
  COMPUTER_GENERATED_NOTICE,
  parseAttendanceRows,
  parseViolationLines,
} from './letter-templates.helper';
import { LetterType } from '@prisma/client';

describe('buildLetterRef', () => {
  it('keeps the full unique sequence instead of truncating to 3 digits', () => {
    expect(buildLetterRef(LetterType.WARNING, '4191/YCDO/2026')).toBe(
      'HRMS/WRN/4191',
    );
  });

  it('returns preview placeholders as-is', () => {
    expect(buildLetterRef(LetterType.WARNING, 'PREVIEW/YCDO/0000')).toBe(
      'PREVIEW/YCDO/0000',
    );
  });
});

describe('appendComputerGeneratedNotice', () => {
  it('appends the notice inside the first page block', () => {
    const html = appendComputerGeneratedNotice(
      '<html><body><div class="page"><p>Hello</p></div></body></html>',
    );
    expect(html).toContain(COMPUTER_GENERATED_NOTICE);
    expect(html.indexOf('computer-generated-notice')).toBeGreaterThan(
      html.indexOf('class="page"'),
    );
  });

  it('does not duplicate when already present', () => {
    const once = appendComputerGeneratedNotice('<html><body></body></html>');
    const twice = appendComputerGeneratedNotice(once);
    expect(twice.match(/computer-generated-notice/g)?.length).toBe(1);
  });
});

describe('letter template parsers', () => {
  it('parses violation lines from newline text', () => {
    expect(parseViolationLines('late\nabsent\n')).toEqual(['late', 'absent']);
  });

  it('parses attendance rows from pipe lines', () => {
    expect(
      parseAttendanceRows('01/08/2026 | 08:00 AM | 05:00 PM\n02/08/2026|09:00|17:00'),
    ).toEqual([
      { date: '01/08/2026', inTime: '08:00 AM', outTime: '05:00 PM' },
      { date: '02/08/2026', inTime: '09:00', outTime: '17:00' },
    ]);
  });

  it('parses attendance rows from JSON', () => {
    expect(
      parseAttendanceRows(
        JSON.stringify([{ date: '01/08/2026', checkIn: '8am', checkOut: '5pm' }]),
      ),
    ).toEqual([{ date: '01/08/2026', inTime: '8am', outTime: '5pm' }]);
  });
});

describe('applyFineUniformWording', () => {
  it('removes کی after آپ in the uniform future-duty line', () => {
    expect(
      applyFineUniformWording('آئندہ آپ کی ڈیوٹی کے دوران یونیفارم لازمی پہنیں'),
    ).toBe('آئندہ آپ ڈیوٹی کے دوران یونیفارم لازمی پہنیں');
  });
});
