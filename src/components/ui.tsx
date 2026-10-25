import Link from "next/link";
import { withParams } from "@/lib/query-string";
import { orderProgress, PROGRESS_STEPS } from "@/lib/order-progress";
import type { OrderStatus } from "@/lib/types";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-2 text-sm text-inksoft">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>/</span>}
            {c.href && i < items.length - 1 ? <Link href={c.href} className="hover:text-ink hover:underline">{c.label}</Link> : <span aria-current={i === items.length - 1 ? "page" : undefined} className={i === items.length - 1 ? "text-ink" : undefined}>{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({ title, subtitle, action, breadcrumbs }: { title: string; subtitle?: string; action?: React.ReactNode; breadcrumbs?: Crumb[] }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-[65ch] text-inksoft">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="rounded-lg border border-dashed border-linestrong bg-white p-8 text-inksoft">
      <strong className="mb-1.5 block text-base font-semibold text-ink">{title}</strong>
      {children && <div className="mb-4">{children}</div>}
      {action && <Link href={action.href} className="btn-primary">{action.label}</Link>}
    </div>
  );
}

// Shown when something failed to load. Always says what happened and offers a way forward; never raw error text.
export function ErrorState({ title = "Something went wrong", children, action }: { title?: string; children?: React.ReactNode; action?: { href: string; label: string } }) {
  return (
    <div role="alert" className="rounded-lg border border-redsig/40 bg-[#FBE4E1] p-6 text-sm text-redsig">
      <strong className="mb-1 block text-base font-semibold">{title}</strong>
      {children && <div className="mb-3">{children}</div>}
      {action && <Link href={action.href} className="btn">{action.label}</Link>}
    </div>
  );
}

// Loading placeholder with reserved height, so the page does not jump when real content arrives.
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

// The one primary thing to do next, shown at the top of a page.
export function NextStep({ title, hint, href, label, tone = "primary" }: { title: string; hint?: string; href: string; label: string; tone?: "primary" | "attention" }) {
  return (
    <div className={`mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border p-5 ${tone === "attention" ? "border-amber/50 bg-[#FEF0D9]" : "border-accent/50 bg-accentsoft"}`}>
      <div className="min-w-0">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-inksoft">{tone === "attention" ? "Needs your attention" : "Next step"}</div>
        <div className="text-base font-semibold">{title}</div>
        {hint && <div className="mt-0.5 text-sm text-inksoft">{hint}</div>}
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

// A small "?" that opens a plain-language explanation. Built on <details>, so it works without JavaScript and by keyboard.
export function HelpTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group relative inline-block align-middle">
      <summary aria-label={`What is ${label}?`} className="flex h-4 w-4 cursor-pointer list-none items-center justify-center rounded-full border border-inputborder text-[10px] font-semibold leading-none text-inksoft hover:bg-mist [&::-webkit-details-marker]:hidden">?</summary>
      <span role="note" className="absolute left-0 top-6 z-30 w-56 max-w-[70vw] rounded-md border border-line bg-white p-3 text-xs font-normal normal-case tracking-normal text-ink shadow-pop">{children}</span>
    </details>
  );
}

export type Chip = { key: string; label: string };

// Removable chips for the filters that are currently applied. Each chip is a plain link to the same page without that
// filter (and back on page 1), so it works without JavaScript.
export function FilterChips({ basePath, params, chips, resetLabel = "Clear all" }: { basePath: string; params: Record<string, string | undefined>; chips: Chip[]; resetLabel?: string }) {
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Applied filters" className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      {chips.map((c) => (
        <li key={c.key}>
          <Link href={withParams(basePath, { ...params, [c.key]: undefined, page: undefined })} aria-label={`Remove filter: ${c.label}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-ink hover:bg-mist">
            {c.label}<span aria-hidden className="text-inksoft">×</span>
          </Link>
        </li>
      ))}
      <li><Link href={basePath} className="px-1 text-accenttext underline">{resetLabel}</Link></li>
    </ul>
  );
}

export type Tab = { key: string; label: string; count?: number | null };

// Tabs that filter a list by one query parameter. Links, not buttons: shareable, back-button friendly, no JavaScript.
export function FilterTabs({ basePath, param = "status", tabs, active, params = {} }: { basePath: string; param?: string; tabs: Tab[]; active: string; params?: Record<string, string | undefined> }) {
  return (
    <nav aria-label="Filter by status" className="mb-4 -mx-1 overflow-x-auto px-1">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <li key={t.key || "all"}>
              <Link href={withParams(basePath, { ...params, [param]: t.key || undefined, page: undefined })} aria-current={on ? "page" : undefined}
                className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors ${on ? "border-accent font-medium text-ink" : "border-transparent text-inksoft hover:text-ink"}`}>
                {t.label}
                {t.count != null && <span className={`rounded-full px-1.5 text-xs ${on ? "bg-accentsoft text-ink" : "bg-mist text-inksoft"}`}>{t.count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// Where the order is in its journey. Colour is never the only signal: each step also has a number or a check, and the
// current step carries aria-current="step" plus a visually hidden state.
export function OrderProgress({ status }: { status: OrderStatus }) {
  const p = orderProgress(status);
  if (p.state === "ended") return null;
  return (
    <ol aria-label="Order progress" className="card mb-6 grid grid-cols-5 gap-1 !p-4 text-center">
      {PROGRESS_STEPS.map((label, i) => {
        const done = i < p.step;
        const current = i === p.step;
        const warn = current && p.state === "attention";
        return (
          <li key={label} aria-current={current ? "step" : undefined} className="min-w-0">
            <span aria-hidden className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-verdigris text-white" : warn ? "bg-amber text-white" : current ? "bg-navy text-white" : "border border-inputborder text-inksoft"}`}>{done ? "✓" : warn ? "!" : i + 1}</span>
            <span className={`mt-1.5 block text-[11px] leading-tight sm:text-xs ${current ? "font-semibold text-ink" : "text-inksoft"}`}>{label}</span>
            <span className="sr-only">{done ? "Done" : warn ? "Needs attention" : current ? "Current step" : "Not started"}</span>
          </li>
        );
      })}
    </ol>
  );
}
