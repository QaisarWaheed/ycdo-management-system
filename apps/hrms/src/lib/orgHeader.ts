/**
 * YCDO letterhead for every printed HRMS document (same layout as the
 * letters: logo left, organisation block right). Print windows opened with
 * window.open('') have no base URL, so the logo URL is absolute.
 */
export const orgLogoUrl = () => `${window.location.origin}/ycdo-logo.jpeg`

export const ORG_HEADER_CSS = `
.org-head{display:flex;justify-content:space-between;align-items:center;gap:12px;border-bottom:2px solid #1e2a78;padding-bottom:6px;margin-bottom:10px}
.org-head img{height:64px;width:auto}
.org-head .org{text-align:right;line-height:1.25}
.org-head .office{font-size:10px;letter-spacing:.5px}
.org-head .name{font-size:14px;font-weight:700;color:#1e2a78}
.org-head .loc{font-size:10px}
.org-title{text-align:center;font-size:15px;font-weight:700;text-decoration:underline;margin:4px 0 10px}`

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

export function orgHeaderHtml(title?: string) {
  return `<div class="org-head"><img src="${orgLogoUrl()}" alt="YCDO" />
<div class="org"><div class="office">OFFICE OF THE</div><div class="name">YOUTH COMMUNITY DEVELOPMENT ORGANIZATION</div><div class="loc">MULTAN, PAKISTAN</div></div></div>${
    title ? `<div class="org-title">${esc(title)}</div>` : ''
  }`
}
