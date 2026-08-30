/** Legacy Start Inquiry is only for non-suspension cases. */
export function canStartLegacyInquiry(action: {
  type: string
  status: string
  inquiry?: unknown | null
}) {
  return (
    action.type !== 'SUSPENSION' &&
    action.status === 'OPEN' &&
    !action.inquiry
  )
}

export function officerNameFromReason(reason?: string | null) {
  const match = reason?.match(/Inquiry officer:\s*(.+?)\./i)
  return match?.[1]?.trim() || null
}

/** Open enquiry even if the Inquiry row was never created (older watchlist start). */
export function isOrphanEnquiryAction(action: {
  type: string
  status: string
  reason?: string | null
  inquiry?: unknown | null
}) {
  if (action.inquiry) return false
  if (action.status === 'UNDER_INQUIRY') return true
  return (
    action.type === 'SUSPENSION' &&
    (action.status === 'OPEN' || action.status === 'UNDER_INQUIRY')
  )
}

export function isOpenEnquiryAction(action: {
  type: string
  status: string
  reason?: string | null
  inquiry?: {
    outcome?: string | null
    closedAt?: string | null
    finalDecisionStatus?: string | null
  } | null
}) {
  if (action.inquiry) {
    return (
      !action.inquiry.outcome &&
      !action.inquiry.closedAt &&
      action.inquiry.finalDecisionStatus !== 'APPLIED'
    )
  }
  return isOrphanEnquiryAction(action)
}
