import { APPOINTMENT_CHAIRMAN_ADMIN_NAME } from './appointment-signatory';
import {
  APPOINTMENT_DRAFT_WATERMARK_TEXT,
  applyAppointmentDraftWatermark,
  htmlHasAppointmentDraftWatermark,
  stripAppointmentDraftWatermark,
} from './appointment-watermark';

describe('appointment draft watermark', () => {
  it('applies visible draft watermark and can strip it', () => {
    const html = '<html><head><style>body{}</style></head><body><p>Hi</p></body></html>';
    const drafted = applyAppointmentDraftWatermark(html);
    expect(htmlHasAppointmentDraftWatermark(drafted)).toBe(true);
    expect(drafted).toContain(APPOINTMENT_DRAFT_WATERMARK_TEXT);
    const clean = stripAppointmentDraftWatermark(drafted);
    expect(htmlHasAppointmentDraftWatermark(clean)).toBe(false);
    expect(clean).not.toContain(APPOINTMENT_DRAFT_WATERMARK_TEXT);
  });

  it('exposes Muhammad Asif Nawaz from the central signatory constant', () => {
    expect(APPOINTMENT_CHAIRMAN_ADMIN_NAME).toBe('Muhammad Asif Nawaz');
  });
});
