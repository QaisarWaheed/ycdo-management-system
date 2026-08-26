import {
  InquiryFinalAction,
  InquiryFinding,
  LetterStatus,
  LetterType,
} from '@prisma/client';
import {
  expectedFinalLetters,
  inquiryResolvedMessage,
  isResolutionTriggerKind,
  letterContentStamps,
  matchFinalLetterStatuses,
  restNotifiesOnApply,
} from './inquiry-final-letters';

describe('inquiry final letter map', () => {
  it('requires REINSTATEMENT for NOT_GUILTY and treats it as the resolution trigger', () => {
    expect(expectedFinalLetters(InquiryFinding.NOT_GUILTY, null)).toEqual([
      {
        letterType: LetterType.REINSTATEMENT,
        inquiryLetterKind: 'REINSTATEMENT',
        triggersEmployeeResolution: true,
      },
    ]);
  });

  it('requires TERMINATION stamped DISMISSAL for DISMISS', () => {
    expect(
      expectedFinalLetters(InquiryFinding.GUILTY, InquiryFinalAction.DISMISS),
    ).toEqual([
      {
        letterType: LetterType.TERMINATION,
        inquiryLetterKind: 'DISMISSAL',
        triggersEmployeeResolution: true,
      },
    ]);
  });

  it('requires TERMINATION stamped TERMINATION for TERMINATE', () => {
    expect(
      expectedFinalLetters(InquiryFinding.GUILTY, InquiryFinalAction.TERMINATE),
    ).toEqual([
      {
        letterType: LetterType.TERMINATION,
        inquiryLetterKind: 'TERMINATION',
        triggersEmployeeResolution: true,
      },
    ]);
  });

  it('requires no letter for REST and notifies on apply as the fallback', () => {
    expect(
      expectedFinalLetters(InquiryFinding.GUILTY, InquiryFinalAction.REST),
    ).toEqual([]);
    expect(
      restNotifiesOnApply(InquiryFinding.GUILTY, InquiryFinalAction.REST),
    ).toBe(true);
  });

  it('requires FINE and REINSTATEMENT for FINE_AND_REINSTATE, with only REINSTATEMENT triggering resolution', () => {
    const expected = expectedFinalLetters(
      InquiryFinding.GUILTY,
      InquiryFinalAction.FINE_AND_REINSTATE,
    );
    expect(expected).toEqual([
      {
        letterType: LetterType.REINSTATEMENT,
        inquiryLetterKind: 'REINSTATEMENT',
        triggersEmployeeResolution: true,
      },
      {
        letterType: LetterType.FINE,
        inquiryLetterKind: 'FINE',
        triggersEmployeeResolution: false,
      },
    ]);
    expect(isResolutionTriggerKind('FINE')).toBe(false);
    expect(isResolutionTriggerKind('REINSTATEMENT')).toBe(true);
  });

  it('marks missing vs draft vs sent without treating REVERSED as present', () => {
    const expected = expectedFinalLetters(InquiryFinding.NOT_GUILTY, null);
    const statuses = matchFinalLetterStatuses(
      expected,
      [
        {
          id: 'rev',
          letterType: LetterType.REINSTATEMENT,
          status: LetterStatus.REVERSED,
          content: { inquiryId: 'inq-1', inquiryLetterKind: 'REINSTATEMENT' },
        },
        {
          id: 'ok',
          letterType: LetterType.REINSTATEMENT,
          status: LetterStatus.DRAFT,
          letterNo: '9/YCDO/2026',
          content: { inquiryId: 'inq-1', inquiryLetterKind: 'REINSTATEMENT' },
        },
      ],
      'inq-1',
    );
    expect(statuses[0]).toMatchObject({
      status: 'DRAFT',
      letterId: 'ok',
      letterNo: '9/YCDO/2026',
    });
  });

  it('stamps inquiry id into the resolution notification message for idempotent lookup', () => {
    expect(inquiryResolvedMessage('inq-1', 'NOT_GUILTY')).toContain('inq-1');
    expect(letterContentStamps({ inquiryId: 'inq-1', inquiryLetterKind: 'FINE' })).toEqual({
      inquiryId: 'inq-1',
      inquiryLetterKind: 'FINE',
    });
  });
});
