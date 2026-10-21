/**
 * YCDO letterhead for every printed HRMS document (same layout as the
 * letters: Bismillah, logo left, organisation block right, italic title on a blue rule). Print windows opened with
 * window.open('') have no base URL, so the logo URL is absolute.
 */
export const orgLogoUrl = () => `${window.location.origin}/ycdo-logo.jpeg`

export const ORG_HEADER_CSS = `
.org-bismillah{text-align:center;font-size:15px;margin-bottom:2px}
.org-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:6px}
.org-head img{height:64px;width:auto}
.org-head .org{text-align:right;line-height:1.25;font-family:'Times New Roman',Times,serif;color:#1b2f7a;font-weight:700}
.org-head .office{font-size:10px;letter-spacing:.5px}
.org-head .name{font-size:14px}
.org-head .loc{font-size:10px}
.org-title{text-align:center;font-family:'Times New Roman',Times,serif;font-style:italic;font-size:18px;font-weight:700;letter-spacing:.5px;border-bottom:2px solid #2f6fd0;padding-bottom:4px;margin:4px 0 10px}`

/** Blue wave at the page foot, as on the letters (same SVG as the API letter footer). */
const WAVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 80" preserveAspectRatio="none" width="100%" height="100%"><path d="M0 62 C200 40 480 18 800 0 L800 80 L0 80 Z" fill="#5b9be6"/><path d="M0 70 C220 54 500 32 800 16 L800 80 L0 80 Z" fill="#1b3f9c"/><path d="M0 76 C240 64 520 44 800 30" stroke="#ffffff" stroke-width="2.5" fill="none" opacity="0.7"/></svg>`

/**
 * One-page documents (loan application, pay fixation): edge-to-edge wave fixed
 * to the page foot. Put after the document's own styles; it replaces @page margins.
 * ponytail: fixed wave repeats on every page and can cover text on a full later page; fine for one-page forms.
 */
export const ORG_DOC_CSS = `
@page{size:A4;margin:10mm 0 0}
body{margin:0;padding:0 16mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.org-wave{position:fixed;left:0;right:0;bottom:0;height:11mm;line-height:0}
.org-wave-space{height:16mm}`

export const orgFooterHtml = () => `<div class="org-wave-space"></div><div class="org-wave">${WAVE_SVG}</div>`

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

export function orgHeaderHtml(title?: string) {
  return `<div class="org-bismillah">بِسْمِ اللّٰهِ الرَّحْمٰنِ الرَّحِيْمِ</div><div class="org-head"><img src="${orgLogoUrl()}" alt="YCDO" />
<div class="org"><div class="office">OFFICE OF THE</div><div class="name">YOUTH COMMUNITY DEVELOPMENT ORGANIZATION</div><div class="loc">MULTAN, PAKISTAN</div></div></div>${
    title ? `<div class="org-title">${esc(title)}</div>` : ''
  }`
}
