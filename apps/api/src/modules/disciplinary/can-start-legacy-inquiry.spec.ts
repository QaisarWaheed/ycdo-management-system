import { readFileSync } from 'fs';
import { join } from 'path';

describe('HR UI Start Inquiry gating', () => {
  function canStartLegacyInquiry(action: {
    type: string;
    status: string;
    inquiry?: unknown | null;
  }) {
    return (
      action.type !== 'SUSPENSION' &&
      action.status === 'OPEN' &&
      !action.inquiry
    );
  }

  it('does not allow Start Inquiry on SUSPENSION', () => {
    expect(
      canStartLegacyInquiry({
        type: 'SUSPENSION',
        status: 'OPEN',
        inquiry: null,
      }),
    ).toBe(false);
  });

  it('allows Start Inquiry on non-suspension OPEN actions without an inquiry', () => {
    expect(
      canStartLegacyInquiry({
        type: 'WARNING',
        status: 'OPEN',
        inquiry: null,
      }),
    ).toBe(true);
  });

  it('DisciplinaryPage uses canStartLegacyInquiry instead of OPEN-only Start Inquiry', () => {
    const page = readFileSync(
      join(
        __dirname,
        '../../../../hrms/src/pages/disciplinary/DisciplinaryPage.tsx',
      ),
      'utf8',
    );
    const helper = readFileSync(
      join(
        __dirname,
        '../../../../hrms/src/lib/disciplinaryInquiryUi.ts',
      ),
      'utf8',
    );
    expect(helper).toContain("action.type !== 'SUSPENSION'");
    expect(page).toContain('canStartLegacyInquiry');
    expect(page).not.toMatch(
      /action\.status === 'OPEN' \? \(\s*<Button[\s\S]*Start Inquiry/,
    );
  });
});
