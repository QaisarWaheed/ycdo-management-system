import {
  InquiryFinalAction,
  InquiryFinding,
  LetterStatus,
  LetterType,
} from '@prisma/client';

export type InquiryLetterKind =
  | 'REINSTATEMENT'
  | 'FINE'
  | 'TERMINATION'
  | 'DISMISSAL';

export type ExpectedFinalLetter = {
  letterType: LetterType;
  inquiryLetterKind: InquiryLetterKind;
  triggersEmployeeResolution: boolean;
};

export type FinalLetterStatus = ExpectedFinalLetter & {
  status: 'DRAFT' | 'SENT' | 'MISSING';
  letterId: string | null;
  letterNo: string | null;
};

export const INQUIRY_RESOLVED_NOTIFICATION = 'INQUIRY_RESOLVED';

export function expectedFinalLetters(
  finding: InquiryFinding | string | null | undefined,
  finalAction: InquiryFinalAction | string | null | undefined,
): ExpectedFinalLetter[] {
  if (finding === InquiryFinding.NOT_GUILTY || finding === 'NOT_GUILTY') {
    return [
      {
        letterType: LetterType.REINSTATEMENT,
        inquiryLetterKind: 'REINSTATEMENT',
        triggersEmployeeResolution: true,
      },
    ];
  }

  if (finalAction === InquiryFinalAction.DISMISS || finalAction === 'DISMISS') {
    return [
      {
        letterType: LetterType.TERMINATION,
        inquiryLetterKind: 'DISMISSAL',
        triggersEmployeeResolution: true,
      },
    ];
  }

  if (
    finalAction === InquiryFinalAction.TERMINATE ||
    finalAction === 'TERMINATE'
  ) {
    return [
      {
        letterType: LetterType.TERMINATION,
        inquiryLetterKind: 'TERMINATION',
        triggersEmployeeResolution: true,
      },
    ];
  }

  if (finalAction === InquiryFinalAction.REST || finalAction === 'REST') {
    return [];
  }

  if (
    finalAction === InquiryFinalAction.FINE_AND_REINSTATE ||
    finalAction === 'FINE_AND_REINSTATE'
  ) {
    return [
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
    ];
  }

  return [];
}

export function restNotifiesOnApply(
  finding: InquiryFinding | string | null | undefined,
  finalAction: InquiryFinalAction | string | null | undefined,
): boolean {
  return (
    finding === InquiryFinding.GUILTY ||
    finding === 'GUILTY'
  ) && (
    finalAction === InquiryFinalAction.REST ||
    finalAction === 'REST'
  );
}

export function inquiryResolvedMessage(
  inquiryId: string,
  finding: string,
): string {
  return `Your inquiry has been resolved (inquiry ${inquiryId}) with finding ${finding}.`;
}

export function isResolutionTriggerKind(
  kind: unknown,
): kind is InquiryLetterKind {
  return (
    kind === 'REINSTATEMENT' ||
    kind === 'TERMINATION' ||
    kind === 'DISMISSAL'
  );
}

export function letterContentStamps(content: unknown): {
  inquiryId: string | null;
  inquiryLetterKind: InquiryLetterKind | null;
} {
  const row = (content ?? {}) as Record<string, unknown>;
  const inquiryId =
    typeof row.inquiryId === 'string' && row.inquiryId.trim()
      ? row.inquiryId
      : null;
  const kind = row.inquiryLetterKind;
  return {
    inquiryId,
    inquiryLetterKind: isResolutionTriggerKind(kind) || kind === 'FINE'
      ? (kind as InquiryLetterKind)
      : null,
  };
}

export function matchFinalLetterStatuses(
  expected: ExpectedFinalLetter[],
  letters: Array<{
    id: string;
    letterType: LetterType | string;
    status: LetterStatus | string;
    letterNo?: string | null;
    content?: unknown;
  }>,
  inquiryId: string,
): FinalLetterStatus[] {
  return expected.map((spec) => {
    const found = letters.find((letter) => {
      if (letter.status === LetterStatus.REVERSED || letter.status === 'REVERSED') {
        return false;
      }
      if (letter.letterType !== spec.letterType) return false;
      const stamps = letterContentStamps(letter.content);
      return (
        stamps.inquiryId === inquiryId &&
        stamps.inquiryLetterKind === spec.inquiryLetterKind
      );
    });
    if (!found) {
      return {
        ...spec,
        status: 'MISSING',
        letterId: null,
        letterNo: null,
      };
    }
    return {
      ...spec,
      status: found.status === LetterStatus.SENT || found.status === 'SENT'
        ? 'SENT'
        : 'DRAFT',
      letterId: found.id,
      letterNo: found.letterNo ?? null,
    };
  });
}

export async function ensureInquiryResolvedNotification(
  db: {
    notification: {
      findFirst: (args: unknown) => Promise<{ id: string } | null>;
      create: (args: unknown) => Promise<unknown>;
    };
  },
  params: { employeeId: string; inquiryId: string; finding: string },
) {
  const message = inquiryResolvedMessage(params.inquiryId, params.finding);
  const existing = await db.notification.findFirst({
    where: {
      employeeId: params.employeeId,
      type: INQUIRY_RESOLVED_NOTIFICATION,
      message: { contains: params.inquiryId },
    },
  });
  if (existing) {
    return { created: false, id: existing.id };
  }
  await db.notification.create({
    data: {
      employeeId: params.employeeId,
      type: INQUIRY_RESOLVED_NOTIFICATION,
      message,
    },
  });
  return { created: true, id: null };
}
