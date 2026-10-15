/** Plain text is escaped by Handlebars; staff never need to enter HTML. */
export const CUSTOM_LETTER_TEMPLATE = {
  code: 'CUSTOM',
  name: 'Custom Letter',
  primaryLanguage: 'en',
  letterCode: 'GEN',
  requiredVars: ['subject', 'letterBody'],
  bodyHtml: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=swap');
    {{{englishLetterStyles}}}
    .custom-body { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8;
      font-family: "Times New Roman", "Noto Naskh Arabic", serif; }
    </style></head><body><h2>YCDO</h2><p>{{letterNo}} | {{issueDate}}</p>
    <p>{{employeeName}}<br>{{designation}}<br>{{branch}}</p>
    <h3 dir="auto">{{subject}}</h3><div class="custom-body" dir="auto">{{letterBody}}</div>
    <p dir="auto">{{senderTitle}}</p></body></html>`,
};
