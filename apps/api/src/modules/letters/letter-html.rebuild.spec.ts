import { LetterType } from '@prisma/client';
import { rebuildStoredLetterHtml } from './letter-html.rebuild';

describe('rebuildStoredLetterHtml', () => {
  it('renders absence notice HTML from a stored template, not a PDF viewer', async () => {
    const prisma = {
      letterTemplate: {
        findFirst: jest.fn().mockResolvedValue({
          bodyHtml: '<p>{{enTitle}} {{employeeName}}</p>',
          letterCode: 'AN',
        }),
      },
    };

    const html = await rebuildStoredLetterHtml(prisma, {
      id: 'letter-1',
      letterType: LetterType.EXPLANATION,
      letterNo: '7007',
      templateCode: null,
      status: 'SENT',
      variables: { employeeName: 'Qaiser Waheed' },
      content: {},
    });

    expect(html).toContain('Qaiser Waheed');
    expect(html).toContain('ABSENCE NOTICE');
    expect(html).not.toContain('about:blank');
  });
});
