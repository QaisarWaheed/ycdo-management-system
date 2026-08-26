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
