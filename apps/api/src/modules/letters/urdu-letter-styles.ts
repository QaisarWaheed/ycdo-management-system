/**
 * Shared CSS for Urdu RTL letters matching ycdo-warning-letter.pdf shell.
 * Injected into every Urdu Handlebars template as {{{letterStyles}}}.
 */
export const URDU_LETTER_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&family=Noto+Naskh+Arabic:wght@400;700&display=swap');

@page { size: A4; margin: 14mm 14mm 16mm 14mm; }

* { box-sizing: border-box; }

body {
  font-family: 'Noto Nastaliq Urdu', 'Noto Naskh Arabic', 'Jameel Noori Nastaleeq',
    'Urdu Typesetting', 'Segoe UI', Tahoma, Arial, sans-serif;
  font-size: 12.5pt;
  line-height: 1.9;
  color: #000;
  margin: 0;
  padding: 0;
  direction: rtl;
  text-align: right;
}

.ltr { direction: ltr; text-align: left; unicode-bidi: embed; }

.page { min-height: 250mm; }

/* ── Letterhead / English notification block (LTR) ── */
.letter-shell-top {
  direction: ltr;
  text-align: left;
  margin-bottom: 10pt;
}

.bismillah {
  direction: rtl;
  text-align: center;
  font-size: 13pt;
  margin-bottom: 8pt;
}

.letterhead-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12pt;
  margin-bottom: 10pt;
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
  margin: 6pt 0 8pt;
}

.notification-block .en-title {
  font-size: 16pt;
  font-weight: 700;
  margin: 0;
}

.hr-line {
  border: 0;
  border-top: 1.5pt solid #222;
  margin: 10pt 0 14pt;
}

/* ── Urdu meta (RTL) ── */
.meta-block {
  text-align: right;
  font-size: 12pt;
  line-height: 1.75;
  margin-bottom: 10pt;
}

.meta-block .row { margin: 0 0 3pt; }
.meta-block .label { font-weight: 700; }
.meta-block .row.subject-row { text-align: center; }

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
  margin: 8pt 0 10pt;
  font-weight: 700;
  text-align: right;
}

.body p {
  margin: 0 0 10pt;
  text-align: justify;
}

.violations {
  margin: 10pt 0 14pt;
}

.violations .heading {
  font-weight: 700;
  margin-bottom: 8pt;
}

.violations ol {
  margin: 0;
  padding: 0 22pt 0 0;
}

.violations li {
  margin-bottom: 6pt;
  text-align: right;
}

.attendance-table {
  width: 100%;
  border-collapse: collapse;
  margin: 12pt 0;
  direction: rtl;
  text-align: center;
  font-size: 11pt;
}

.attendance-table th,
.attendance-table td {
  border: 1px solid #333;
  padding: 6pt 8pt;
}

.attendance-table th { background: #f3f3f3; }

.blessing {
  text-align: center;
  margin: 16pt 0 8pt;
  font-weight: 700;
}

.closing {
  margin-top: 8pt;
  text-align: right;
}

.signature {
  margin-top: 28pt;
  text-align: left;
  font-size: 12pt;
  line-height: 1.7;
}

.signature .sig-line {
  display: inline-block;
  width: 120pt;
  border-top: 1px solid #000;
  margin-bottom: 6pt;
}

.fill-line {
  display: inline-block;
  min-width: 80pt;
  border-bottom: 1px solid #000;
}
`;
