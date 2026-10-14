import type { HistoryPoint } from "@/lib/seo/types";

// Dependency-free SVG charts (server-rendered, no client JavaScript). Empty input renders nothing, never a flat zero line.

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1000)}K`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function countryName(code: string): string {
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code.toUpperCase(); } catch { return code.toUpperCase(); }
}

export function LineChart({ points, label, unit = "" }: { points: HistoryPoint[]; label: string; unit?: string }) {
  if (points.length < 2) return <p className="text-sm text-inksoft">Not enough history returned by the provider to draw a trend.</p>;
  const W = 560, H = 140, P = 8;
  const min = Math.min(...points.map((p) => p.value)), max = Math.max(...points.map((p) => p.value));
  const span = max - min || 1;
  const x = (i: number) => P + (i * (W - 2 * P)) / (points.length - 1);
  const y = (v: number) => H - P - ((v - min) / span) * (H - 2 * P);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const first = points[0], last = points[points.length - 1];
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: from ${fmtNum(first.value)}${unit} on ${first.date} to ${fmtNum(last.value)}${unit} on ${last.date}`} className="w-full h-auto">
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2" className="text-verdigrisdark" />
        <circle cx={x(points.length - 1)} cy={y(last.value)} r="3.5" className="fill-current text-verdigrisdark" />
      </svg>
      <figcaption className="flex justify-between text-[11px] text-inksoft"><span>{first.date} · {fmtNum(first.value)}{unit}</span><span>{last.date} · {fmtNum(last.value)}{unit}</span></figcaption>
    </figure>
  );
}

export function BarList({ rows }: { rows: { label: string; value: number; detail?: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (rows.length === 0 || max <= 0) return null;
  return (
    <ul className="grid gap-2">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="flex justify-between gap-3"><span>{r.label}</span><span className="font-mono text-inksoft">{r.detail ?? fmtNum(r.value)}</span></div>
          <div className="h-2 rounded bg-paperdim" role="presentation"><div className="h-2 rounded bg-verdigrisdark" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
