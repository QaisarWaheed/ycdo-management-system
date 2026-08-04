import {
  employeeOnboardingApi,
  type EmployeeApproverTarget,
} from '@/api/endpoints/employeeOnboarding'

/**
 * Open WhatsApp Web / app with a prefilled onboarding-approval message.
 * Uses wa.me redirect (no Meta Cloud API).
 */
export async function openOnboardingWhatsAppShare(input: {
  approverTarget?: EmployeeApproverTarget
  employeeId?: string
  /** Optional manual override, e.g. 0300xxxxxxx */
  phone?: string
}): Promise<{
  waUrl: string
  phoneConfigured: boolean
  approverLabel: string
}> {
  const share = await employeeOnboardingApi.getWhatsAppShare({
    approverTarget: input.approverTarget,
    employeeId: input.employeeId,
    phone: input.phone,
    hrmsBaseUrl: window.location.origin,
  })

  window.open(share.waUrl, '_blank', 'noopener,noreferrer')
  return {
    waUrl: share.waUrl,
    phoneConfigured: share.phoneConfigured,
    approverLabel: share.approverLabel,
  }
}
