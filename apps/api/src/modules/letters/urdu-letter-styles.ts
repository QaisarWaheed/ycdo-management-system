/**
 * Shared CSS for Urdu RTL letters. Injected into every Urdu Handlebars
 * template as {{{letterStyles}}}. Uses Google Fonts when online; falls
 * back to common system Urdu fonts for offline Puppeteer runs.
 */
export const URDU_LETTER_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&family=Noto+Naskh+Arabic:wght@400;700&display=swap');

@page { size: A4; margin: 18mm 16mm 18mm 16mm; }

* { box-sizing: border-box; }

body {
  font-family: 'Noto Nastaliq Urdu', 'Noto Naskh Arabic', 'Jameel Noori Nastaleeq',
    'Urdu Typesetting', 'Segoe UI', Tahoma, Arial, sans-serif;
  font-size: 13pt;
  line-height: 1.85;
  color: #000;
  margin: 0;
  padding: 0;
  direction: rtl;
  text-align: right;
}

.ltr { direction: ltr; text-align: left; unicode-bidi: embed; }

.page { min-height: 240mm; }

.meta-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 14pt;
  gap: 12pt;
  direction: ltr; /* keep Letter No. on the visual left like samples */
}

.letter-no {
  direction: ltr;
  text-align: left;
  font-weight: bold;
  font-size: 11pt;
  white-space: nowrap;
}

.meta-block {
  text-align: right;
  font-size: 11.5pt;
  line-height: 1.7;
}

.meta-block .row { margin: 0 0 2pt; }
.meta-block .label { font-weight: bold; }

.center-title {
  text-align: center;
  font-weight: bold;
  font-size: 14pt;
  margin: 8pt 0 14pt;
  direction: ltr;
}

.subject-line {
  text-align: right;
  font-weight: bold;
  margin: 6pt 0 10pt;
}

.salutation {
  margin: 10pt 0;
  font-weight: bold;
}

.body p {
  margin: 0 0 10pt;
  text-align: justify;
}

.violations {
  margin: 10pt 0 14pt;
}

.violations .heading {
  font-weight: bold;
  margin-bottom: 6pt;
}

.violations ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.violations li {
  border-bottom: 1px dashed #333;
  min-height: 22pt;
  margin-bottom: 8pt;
  padding-bottom: 2pt;
}

.attendance-table {
  width: 100%;
  border-collapse: collapse;
  margin: 12pt 0;
  direction: ltr;
  text-align: center;
  font-size: 11pt;
  font-family: 'Segoe UI', Arial, sans-serif;
}

.attendance-table th,
.attendance-table td {
  border: 1px solid #333;
  padding: 6pt 8pt;
}

.attendance-table th { background: #f3f3f3; }

.closing {
  margin-top: 18pt;
  text-align: right;
}

.signature {
  margin-top: 36pt;
  text-align: left;
  direction: rtl;
  font-size: 11.5pt;
  line-height: 1.6;
}

.signature.ltr-sign {
  direction: ltr;
  text-align: left;
}

.en-body {
  direction: ltr;
  text-align: left;
  font-family: 'Times New Roman', Times, Georgia, serif;
  font-size: 12pt;
  line-height: 1.55;
}

.en-body .header-row {
  display: flex;
  justify-content: space-between;
  font-weight: bold;
  margin-bottom: 16pt;
}

.en-body h1 {
  text-align: center;
  font-size: 14pt;
  text-decoration: underline;
  margin: 12pt 0 16pt;
}

.en-body table {
  width: 100%;
  border-collapse: collapse;
  margin: 12pt 0;
}

.en-body table th,
.en-body table td {
  border: 1px solid #333;
  padding: 6pt 8pt;
  text-align: left;
}

.en-body .sign {
  margin-top: 40pt;
  text-align: right;
}

.fill-line {
  display: inline-block;
  min-width: 80pt;
  border-bottom: 1px solid #000;
}
`;
