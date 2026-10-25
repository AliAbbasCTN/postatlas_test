import { drBand, drRing, clampDr, DR_ATTRIBUTION, DR_LICENSE_URL } from "@/lib/seo/dr";

// Domain Rating as a progress ring (0-100, starting at 12 o'clock), the way SEO tools draw it. Server component, no JavaScript.
// Accessible: the meaning is carried by text (the number, the band name and an aria-label), never by colour alone.
// Licence: Ahrefs requires the attribution "Domain Rating by Ahrefs" with a link to https://ahrefs.com/ wherever DR is shown.
export function DomainRatingBadge({ value, asOf, domain, size = 144 }: { value: number; asOf?: string; domain?: string; size?: number }) {
  const dr = clampDr(value);
  const band = drBand(dr);
  const { dash, gap } = drRing(dr);
  const shown = Math.round(dr);
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className={`relative shrink-0 ${band.text}`} style={{ width: size, height: size }}>
        <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`Domain Rating ${shown} out of 100${domain ? ` for ${domain}` : ""}, by Ahrefs`}>
          <circle cx="60" cy="60" r="52" fill="none" stroke="#E2E8F0" strokeWidth="10" />
          {dr > 0 && <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${dash} ${gap}`} transform="rotate(-90 60 60)" />}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-ink" aria-hidden>
          <span className="font-mono text-4xl font-semibold leading-none">{shown}</span>
          <span className="mt-1 text-[11px] font-medium uppercase tracking-wide text-inksoft">DR</span>
        </div>
      </div>
      <div className="min-w-0 max-w-[46ch]">
        <div className="text-sm font-semibold">Domain Rating: {band.label}</div>
        <p className="mt-1 text-sm text-inksoft">A 0 to 100 score of how strong this website&apos;s backlink profile is compared with other sites in Ahrefs&apos; index. It is not a Google ranking factor.</p>
        <p className="mt-2 text-xs text-inksoft">
          <a href="https://ahrefs.com/" target="_blank" rel="noopener noreferrer" className="underline">{DR_ATTRIBUTION}</a>
          {asOf ? <> · fetched {new Date(asOf).toISOString().slice(0, 10)}</> : null} · <a href={DR_LICENSE_URL} target="_blank" rel="noopener noreferrer" className="underline">licence</a>
        </p>
      </div>
    </div>
  );
}
