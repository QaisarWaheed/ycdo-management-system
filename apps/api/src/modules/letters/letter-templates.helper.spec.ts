import * as fs from 'fs';
import * as path from 'path';
import {
  appendComputerGeneratedNotice,
  applyFineUniformWording,
  buildLetterRef,
  COMPUTER_GENERATED_NOTICE,
  englishTransferTime,
  parseAttendanceRows,
  parseViolationLines,
} from './letter-templates.helper';
import { URDU_LETTER_STYLES } from './urdu-letter-styles';
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
    expect(twice.match(/class="computer-generated-notice"/g)?.length).toBe(1);
  });

  it('still appends when only a CSS rule uses the class name', () => {
    const html = appendComputerGeneratedNotice(
      '<html><head><style>.computer-generated-notice{color:#333}</style></head><body></body></html>',
    );
    expect(html).toContain('class="computer-generated-notice"');
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

describe('English letter templates', () => {
  const tplDir = path.join(
    __dirname,
    '../../../prisma/seeds/templates/letters',
  );

  it('drop signature blocks from appreciation, increment, and transfer', () => {
    for (const file of ['APPRECIATION.hbs', 'SALARY_INCREMENT.hbs', 'TRANSFER.hbs']) {
      const html = fs.readFileSync(path.join(tplDir, file), 'utf8');
      expect(html).not.toMatch(/class="signblock"/);
      expect(html).not.toMatch(/Sincerely,/);
      expect(html).not.toMatch(/Volunteer Signature/);
    }
  });

  it('transfer table lists Sr. No., name, designation, branches, and time', () => {
    const html = fs.readFileSync(path.join(tplDir, 'TRANSFER.hbs'), 'utf8');
    expect(html).toContain('Sr. No.');
    expect(html).toContain('Employee Name');
    expect(html).toContain('Designation');
    expect(html).toContain('From Branch');
    expect(html).toContain('To Branch');
    expect(html).toContain('Time');
    expect(html).toContain('یا اللہ');
    expect(html).toContain('NOTIFICATION OF TRANSFER');
  });
});

describe('URDU_LETTER_STYLES compact single-page content', () => {
  it('shrinks body content while keeping letterhead and title sizes', () => {
    expect(URDU_LETTER_STYLES).toMatch(/body\s*\{[^}]*font-size:\s*10\.5pt/s);
    expect(URDU_LETTER_STYLES).toMatch(/\.body p\s*\{[^}]*font-size:\s*10\.5pt/s);
    expect(URDU_LETTER_STYLES).toMatch(
      /\.notification-block \.en-title\s*\{[^}]*font-size:\s*16pt/s,
    );
    expect(URDU_LETTER_STYLES).toMatch(
      /\.letterhead-org \.org-name\s*\{[^}]*font-size:\s*13pt/,
    );
    expect(URDU_LETTER_STYLES).toMatch(
      /\.violations \.heading\s*\{[^}]*font-size:\s*12pt/s,
    );
  });
});

describe('englishTransferTime', () => {
  it('formats duty start/end as 12-hour range', () => {
    expect(
      englishTransferTime({ dutyStartTime: '08:00', dutyEndTime: '15:00' }),
    ).toBe('08:00 AM to 03:00 PM');
  });
});
