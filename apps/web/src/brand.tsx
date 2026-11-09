export function Brand() {
  return <span className="brand-mark brand-wordmark" aria-label="gloomi">gloomi</span>;
}
/** Retained vector fallback for exported graphics; product wordmarks use a font. */
export function BrandFallback() {
  return <svg className="brand-mark" viewBox="0 0 220 78" role="img" aria-label="gloomi" fill="none">
    <g stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M30 27C9 18 4 55 25 55C38 55 39 29 38 27V59C38 76 14 77 12 66M38 43C48 43 51 36 51 26V12C51 3 61 4 61 13V43C61 59 78 58 81 45"/>
      <path d="M99 40C99 20 76 21 76 40C76 61 99 61 99 40C99 34 106 34 108 40C108 60 131 60 131 40C131 20 108 20 108 40M131 40C137 40 138 29 143 28C151 25 155 30 155 39V53V37C155 25 174 24 174 38V53V37C174 25 193 24 193 38V46C193 58 207 57 207 45V28"/>
    </g>
    <circle cx="207" cy="13" r="4.5" fill="currentColor"/>
  </svg>;
}
