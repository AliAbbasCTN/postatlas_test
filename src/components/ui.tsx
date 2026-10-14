import Link from "next/link";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
      <div>
        <h1 className="font-serif font-bold text-3xl">{title}</h1>
        {subtitle && <p className="text-inksoft mt-1.5 max-w-[65ch]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="border border-dashed border-line rounded-md p-8 text-inksoft bg-white">
      <strong className="block font-serif text-ink text-lg mb-1.5">{title}</strong>
      {children && <div className="mb-4">{children}</div>}
      {action && <Link href={action.href} className="btn-primary">{action.label}</Link>}
    </div>
  );
}

// The one primary thing to do next, shown at the top of a page.
export function NextStep({ title, hint, href, label, tone = "primary" }: { title: string; hint?: string; href: string; label: string; tone?: "primary" | "attention" }) {
  return (
    <div className={`rounded-md border p-5 mb-8 flex flex-wrap items-center justify-between gap-4 ${tone === "attention" ? "border-amber bg-[#FBEBDA]" : "border-verdigris bg-[#E4EEEA]"}`}>
      <div>
        <div className="text-xs uppercase tracking-wide text-inksoft mb-1">{tone === "attention" ? "Needs your attention" : "Next step"}</div>
        <div className="font-serif font-semibold text-lg">{title}</div>
        {hint && <div className="text-sm text-inksoft mt-0.5">{hint}</div>}
      </div>
      <Link href={href} className="btn-primary">{label}</Link>
    </div>
  );
}

export function Pagination({ basePath, page, pageSize, total, params = {} }: { basePath: string; page: number; pageSize: number; total: number; params?: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between mt-6 text-sm">
      <span className="text-inksoft">Page {page} of {pages} ({total.toLocaleString("en-US")} results)</span>
      <span className="flex gap-2">
        {page > 1 && <Link className="btn" href={href(page - 1)} rel="prev">Previous</Link>}
        {page < pages && <Link className="btn" href={href(page + 1)} rel="next">Next</Link>}
      </span>
    </nav>
  );
}

export function parsePage(v: string | undefined): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

export function Money({ value }: { value: number | string | null | undefined }) {
  if (value == null) return <span className="text-inksoft">-</span>;
  return <span className="font-mono">${Number(value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function Metric({ label, value, status, source }: { label: string; value: React.ReactNode; status: "observed" | "verified" | "self_reported" | "unavailable" | "estimated" | "calculated"; source?: string }) {
  const tag = { observed: "Observed", verified: "Verified by PostAtlas", self_reported: "Reported by publisher", unavailable: "Not available", estimated: "Estimate", calculated: "Calculated" }[status];
  return (
    <div>
      <div className="text-xs text-inksoft">{label}</div>
      <div className={`font-mono text-lg ${status === "unavailable" ? "text-inksoft italic" : ""}`}>{status === "unavailable" ? "Not available" : value}</div>
      <div className="text-[11px] text-inksoft">{tag}{source ? ` · ${source}` : ""}</div>
    </div>
  );
}
