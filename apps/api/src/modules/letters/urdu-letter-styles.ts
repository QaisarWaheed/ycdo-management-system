/**
 * Shared CSS for Urdu RTL letters matching ycdo-warning-letter.pdf shell.
 * Injected into every Urdu Handlebars template as {{{letterStyles}}}.
 *
 * Body/content is compact so warning, fine, advice, and similar short letters
 * stay on one A4 page. Headings (letterhead, English title, violation heading)
 * keep their larger sizes.
 */
export const URDU_LETTER_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&family=Noto+Naskh+Arabic:wght@400;700&display=swap');

@page { size: A4; margin: 14mm 14mm 16mm 14mm; }

* { box-sizing: border-box; }

body {
  font-family: 'Noto Nastaliq Urdu', 'Noto Naskh Arabic', 'Jameel Noori Nastaleeq',
    'Urdu Typesetting', 'Segoe UI', Tahoma, Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.7;
  color: #000;
  margin: 0;
  padding: 0;
  direction: rtl;
  text-align: right;
}

.ltr { direction: ltr; text-align: left; unicode-bidi: embed; }

.computer-generated-notice {
  margin-top: 24pt;
  padding-top: 8pt;
  border-top: 1px solid #ccc;
  text-align: center;
  font-size: 9.5pt;
  font-family: 'Segoe UI', Arial, sans-serif;
  direction: ltr;
  color: #333;
  line-height: 1.35;
  page-break-inside: avoid;
  break-inside: avoid;
}

@media print {
  .page {
    min-height: auto !important;
    display: block !important;
  }
}

/* ── Letterhead / English notification block (LTR) ── */
.letter-shell-top {
  direction: ltr;
  text-align: left;
  margin-bottom: 6pt;
}

.bismillah {
  direction: rtl;
  text-align: center;
  font-size: 13pt;
  margin-bottom: 6pt;
}

.letterhead-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12pt;
  margin-bottom: 6pt;
}

.letterhead-right {
  text-align: right;
}

.letterhead-org {
  text-align: right;
  font-family: 'Times New Roman', Times, Georgia, serif;
}

.letterhead-org .office { font-size: 10.5pt; }
.letterhead-org .org-name { font-size: 13pt; font-weight: 700; line-height: 1.25; }
.letterhead-org .loc { font-size: 10.5pt; }

.letterhead-logo {
  width: 78pt;
  height: auto;
  object-fit: contain;
}

.letterhead-logo-fallback {
  width: 78pt;
  font-family: 'Segoe UI', Arial, sans-serif;
  font-size: 9pt;
  font-weight: 700;
  color: #1a3a6b;
  line-height: 1.25;
}

.letter-nos {
  margin-top: 6pt;
  text-align: right;
  font-family: 'Segoe UI', Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.45;
  direction: ltr;
}

.letter-nos .letter-no-line {
  font-weight: 700;
}

.notification-block {
  text-align: center;
  direction: ltr;
  font-family: 'Times New Roman', Times, Georgia, serif;
  margin: 4pt 0 6pt;
}

.notification-block .en-title {
  font-size: 16pt;
  font-weight: 700;
  margin: 0;
}

/* ── Urdu meta (RTL) ── */
.meta-block {
  text-align: right;
  font-size: 10.5pt;
  line-height: 1.6;
  margin-bottom: 6pt;
}

.meta-block .row { margin: 0 0 2pt; }
.meta-block .label { font-weight: 700; }
.meta-block .row.subject-row {
  text-align: center;
  font-size: 12pt;
}

/* Designation + branch together as one bold, isolated LTR unit so the two
   embedded English runs never get reordered relative to each other by the
   bidi algorithm — different renderers can otherwise disagree on the
   visual order of two adjacent LTR runs inside an RTL paragraph. */
.identity-strong {
  font-weight: 700;
  direction: ltr;
  unicode-bidi: isolate;
  display: inline-block;
}

.salutation {
  margin: 4pt 0 6pt;
  font-weight: 700;
  text-align: right;
}

.body p {
  margin: 0 0 6pt;
  text-align: justify;
  font-size: 10.5pt;
}

.violations {
  margin: 6pt 0 8pt;
}

.violations .heading {
  font-weight: 700;
  font-size: 12pt;
  margin-bottom: 6pt;
}

.violations ol {
  margin: 0;
  padding: 0 22pt 0 0;
}

.violations li {
  margin-bottom: 3pt;
  text-align: right;
}

.attendance-table {
  width: 100%;
  border-collapse: collapse;
  margin: 8pt 0;
  direction: rtl;
  text-align: center;
  font-size: 10pt;
}

.attendance-table th,
.attendance-table td {
  border: 1px solid #333;
  padding: 4pt 6pt;
}

.attendance-table th { background: #f3f3f3; }

.blessing {
  text-align: center;
  margin: 8pt 0 4pt;
  font-weight: 700;
  font-size: 12pt;
  page-break-inside: avoid;
  break-inside: avoid;
}

.closing {
  margin-top: 4pt;
  text-align: left;
  page-break-inside: avoid;
  break-inside: avoid;
  page-break-before: avoid;
  break-before: avoid;
}

.signature {
  margin-top: 14pt;
  text-align: left;
  font-size: 10.5pt;
  line-height: 1.55;
  page-break-inside: avoid;
  break-inside: avoid;
  page-break-before: avoid;
  break-before: avoid;
}

.fill-line {
  display: inline-block;
  min-width: 80pt;
  border-bottom: 1px solid #000;
}
`;
