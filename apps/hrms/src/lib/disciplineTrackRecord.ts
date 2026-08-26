import type { DisciplinaryAction, Letter } from '@/types'

export type DisciplineTrackRow = {
  key: string
  label: string
  count: number
}

function isIssuedDisciplineLetter(letter: Letter): boolean {
  if (letter.status && letter.status !== 'SENT') return false
  const vars = letter.variables as
    | { reversed?: boolean; reversedDueToShortLeave?: boolean }
    | null
    | undefined
  if (vars?.reversed || vars?.reversedDueToShortLeave) return false
  return true
}

function countLetters(letters: Letter[], types: string[]): number {
  return letters.filter((letter) => types.includes(letter.letterType)).length
}

function countAppliedInquiryAction(
  actions: DisciplinaryAction[],
  finalAction: string,
): number {
  return actions.filter(
    (action) =>
      action.inquiry?.finalDecisionStatus === 'APPLIED' &&
      action.inquiry.finalAction === finalAction,
  ).length
}

function countInquiryOutcome(
  actions: DisciplinaryAction[],
  outcome: string,
): number {
  return actions.filter((action) => action.inquiry?.outcome === outcome).length
}

/** Issued (SENT) letters plus applied inquiry outcomes for the profile sidebar. */
export function buildDisciplineTrackRecord(
  letters: Letter[],
  actions: DisciplinaryAction[],
): DisciplineTrackRow[] {
  const issued = letters.filter(isIssuedDisciplineLetter)
  const onRest = Math.max(
    countAppliedInquiryAction(actions, 'REST'),
    countInquiryOutcome(actions, 'REST'),
  )
  const dismissed = Math.max(
    countAppliedInquiryAction(actions, 'DISMISS'),
    countInquiryOutcome(actions, 'DISMISSED'),
  )

  return [
    { key: 'advice', label: 'Advice', count: countLetters(issued, ['ADVICE']) },
    { key: 'warning', label: 'Warning', count: countLetters(issued, ['WARNING']) },
    {
      key: 'explanation',
      label: 'Explanation',
      count: countLetters(issued, ['EXPLANATION']),
    },
    {
      key: 'fined',
      label: 'Fined',
      count: countLetters(issued, ['FINE', 'EXPLANATION_FINE']),
    },
    {
      key: 'showCause',
      label: 'Show cause',
      count: countLetters(issued, ['SHOW_CAUSE']),
    },
    {
      key: 'suspended',
      label: 'Suspended',
      count: countLetters(issued, ['SUSPENSION']),
    },
    { key: 'onRest', label: 'On rest', count: onRest },
    {
      key: 'terminated',
      label: 'Terminated',
      count: countLetters(issued, ['TERMINATION']),
    },
    { key: 'dismissed', label: 'Dismissed', count: dismissed },
    {
      key: 'reinstated',
      label: 'Reinstated',
      count: countLetters(issued, ['REINSTATEMENT']),
    },
  ]
}

export function disciplineTrackTotal(rows: DisciplineTrackRow[]): number {
  return rows.reduce((sum, row) => sum + row.count, 0)
}
