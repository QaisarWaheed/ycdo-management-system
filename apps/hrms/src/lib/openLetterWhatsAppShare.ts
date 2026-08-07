import { lettersApi } from '@/api/endpoints/letters'
import { downloadLetterPdf } from '@/lib/downloadLetterPdf'

/**
 * Preview + send a letter via WhatsApp Web (wa.me).
 * Downloads the PDF for HR to attach manually — wa.me cannot attach files.
 */
export async function openLetterWhatsAppShare(letterId: string): Promise<{
  waUrl: string
  phoneConfigured: boolean
  filename: string
}> {
  const share = await lettersApi.getWhatsAppShare(letterId)

  await downloadLetterPdf(letterId, share.filename)

  window.open(share.waUrl, '_blank', 'noopener,noreferrer')

  await lettersApi.markWhatsAppShared(letterId)

  return {
    waUrl: share.waUrl,
    phoneConfigured: share.phoneConfigured,
    filename: share.filename,
  }
}
