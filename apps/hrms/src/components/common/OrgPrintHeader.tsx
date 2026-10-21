/** YCDO letterhead for printed pages rendered inside the app (same look as orgHeaderHtml). */
export function OrgPrintHeader({ title, subtitle }: { title?: string; subtitle?: string }) {
  return (
    <div className="mb-3 text-black">
      <div className="text-center" style={{ fontSize: 15 }}>
        بِسْمِ اللّٰهِ الرَّحْمٰنِ الرَّحِيْمِ
      </div>
      <div className="flex items-center justify-between gap-3 pb-1.5">
        <img src="/ycdo-logo.jpeg" alt="YCDO" style={{ height: 64, width: 'auto' }} />
        <div
          className="text-right leading-tight"
          style={{ fontFamily: "'Times New Roman', Times, serif", color: '#1b2f7a', fontWeight: 700 }}
        >
          <div style={{ fontSize: 10, letterSpacing: 0.5 }}>OFFICE OF THE</div>
          <div style={{ fontSize: 14 }}>
            YOUTH COMMUNITY DEVELOPMENT ORGANIZATION
          </div>
          <div style={{ fontSize: 10 }}>MULTAN, PAKISTAN</div>
        </div>
      </div>
      {title ? (
        <div
          className="mt-1 text-center font-bold italic"
          style={{
            fontSize: 18,
            fontFamily: "'Times New Roman', Times, serif",
            borderBottom: '2px solid #2f6fd0',
            paddingBottom: 4,
          }}
        >
          {title}
        </div>
      ) : null}
      {subtitle ? <div className="text-center text-sm">{subtitle}</div> : null}
    </div>
  )
}
