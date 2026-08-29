export const APPOINTMENT_DRAFT_WATERMARK_TEXT =
  'DRAFT — NOT VALID FOR APPOINTMENT';

export const APPOINTMENT_DRAFT_WATERMARK_SUBTEXT = 'For HR Review Only';

const WATERMARK_MARK = 'appointment-draft-watermark';

const WATERMARK_CSS = `
.appointment-draft-watermark {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.appointment-draft-watermark-inner {
  transform: rotate(-32deg);
  text-align: center;
  opacity: 0.18;
  color: #b91c1c;
  font-family: Arial, Helvetica, sans-serif;
  font-weight: 800;
  letter-spacing: 0.04em;
  line-height: 1.2;
  user-select: none;
}
.appointment-draft-watermark-text {
  font-size: 42pt;
}
.appointment-draft-watermark-sub {
  margin-top: 8pt;
  font-size: 16pt;
  letter-spacing: 0.12em;
}
`;

const WATERMARK_HTML = `<div class="${WATERMARK_MARK}" aria-hidden="true"><div class="appointment-draft-watermark-inner"><div class="appointment-draft-watermark-text">${APPOINTMENT_DRAFT_WATERMARK_TEXT}</div><div class="appointment-draft-watermark-sub">${APPOINTMENT_DRAFT_WATERMARK_SUBTEXT}</div></div></div>`;

export function htmlHasAppointmentDraftWatermark(html: string): boolean {
  return html.includes(WATERMARK_MARK) && html.includes(APPOINTMENT_DRAFT_WATERMARK_TEXT);
}

export function applyAppointmentDraftWatermark(html: string): string {
  if (htmlHasAppointmentDraftWatermark(html)) return html;
  let next = html;
  if (/<style[\s>]/i.test(next)) {
    next = next.replace(/<style([^>]*)>/i, `<style$1>${WATERMARK_CSS}`);
  } else if (/<\/head>/i.test(next)) {
    next = next.replace(/<\/head>/i, `<style>${WATERMARK_CSS}</style></head>`);
  } else {
    next = `<style>${WATERMARK_CSS}</style>${next}`;
  }
  if (/<body[^>]*>/i.test(next)) {
    return next.replace(/<body([^>]*)>/i, `<body$1>${WATERMARK_HTML}`);
  }
  return `${WATERMARK_HTML}${next}`;
}

export function stripAppointmentDraftWatermark(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?appointment-draft-watermark[\s\S]*?<\/style>/gi, (block) => {
      if (!block.includes(WATERMARK_MARK)) return block;
      return '';
    })
    .replace(
      /<div class="appointment-draft-watermark"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi,
      '',
    );
}
