jest.mock('./pdf.helper', () => ({}));
import { EmployeeStatus } from '@prisma/client';
import { LettersService } from './letters.service';
import { statusLetterTemplate } from './status-letter.template';

it('fills the status label on a Rest Letter when the dialog does not send it', async () => {
  const template = { id: 't', version: 1, active: true, ...statusLetterTemplate(EmployeeStatus.ON_REST)! };
  const service: any = Object.create(LettersService.prototype);
  service.prisma = {
    employee: { findUnique: jest.fn().mockResolvedValue({ id: 'e', employeeCode: 'E1', fullName: 'Ali', currentDesignation: 'Staff' }) },
    letterTemplate: { upsert: jest.fn(), findFirst: jest.fn().mockResolvedValue(template) },
  };
  const built = await service.buildTemplatedLetterHtml('e', 'CUSTOM',
    { statusReason: 'Medical rest', statusEffectiveDate: '2026-10-17' }, '1/YCDO/2026', 'STATUS_ON_REST');
  expect(built.variables).toMatchObject({ staffStatus: 'ON_REST', staffStatusLabel: 'ON REST' });
  expect(built.htmlContent).toContain('آپ کی ملازمت کی موجودہ حیثیت: ON REST');
});
