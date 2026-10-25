// The PostAtlas mark. Geometry is copied verbatim from public/favicon.svg (the only brand asset in the project), so
// the header, footer, sign-in pages and dashboard show the same mark as the browser tab. It is inline SVG: no image
// request, no path or CSP problem, and a fixed viewBox keeps the aspect ratio at any size.
// `onDark` adds a thin light ring because the mark's own tile is dark navy and would vanish on a dark background.
export function BrandMark({ size = 28, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="PostAtlas" className="shrink-0" focusable="false">
      <rect width="64" height="64" rx="14" fill="#0F1A2B" />
      {onDark ? <rect x="1" y="1" width="62" height="62" rx="13" fill="none" stroke="#F7F6F3" strokeOpacity="0.45" strokeWidth="2" /> : null}
      <circle cx="20" cy="44" r="7" fill="none" stroke="#F2AE72" strokeWidth="4" />
      <circle cx="44" cy="20" r="7" fill="#2F6E62" />
      <path d="M25 39 L39 25" stroke="#F7F6F3" strokeWidth="4" strokeLinecap="round" />
      <path d="M40 16.5 L43 20.5 L49.5 12.5" fill="none" stroke="#F7F6F3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
