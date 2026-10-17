import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";
import { rankPublishers, explainMatch } from "@/lib/matching";
import { MATCH_SELECT, toCandidates } from "@/lib/match-data";
import { isUuid } from "@/lib/validation";
import { CheckForm } from "@/components/CheckForm";
import { Money, fmtDateTime } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import type { SiteCheckResult } from "@/lib/services/site-check";
import { SeoReport } from "@/components/seo/SeoReport";

// The website check can take up to ~30s; allow the host to run this route that long.
export const maxDuration = 60;
export const metadata = { title: "Your website report", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const WHY_UNREACHABLE: Record<string, string> = {
  dns: "We could not find that website address. Please check the spelling.",
  timeout: "The website took too long to respond.",
  connection: "We could not connect to the website.",
  blocked: "That address cannot be checked.",
  too_large: "The homepage was too large for us to read.",
  not_html: "The address did not return a web page.",
  too_many_redirects: "The address redirected too many times.",
  http_401: "The website asked for a login.", http_403: "The website blocked our check.", http_404: "The homepage was not found (404).",
  http_429: "The website is limiting requests right now.", http_500: "The website returned a server error."
};

export default async function CheckReport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { data: row } = await createAdminClient().from("site_checks").select("id, domain, category, result, created_at").eq("id", id).maybeSingle();
  if (!row) notFound();
  const r = row.result as SiteCheckResult;

  const { data: pubs } = await createPublicClient().from("publisher_websites").select(MATCH_SELECT).eq("status", "approved").limit(300);
  const ranked = r.reachable ? rankPublishers({ category: row.category }, toCandidates(pubs ?? []), 6) : [];

  const improve = r.checklist.filter((c) => c.state !== "good");
  const good = r.checklist.filter((c) => c.state === "good");

  return (
    <section className="py-10 md:py-14">
      <div className="max-w-[1000px] mx-auto px-6">
        <p className="text-sm text-inksoft mb-2">Checked {fmtDateTime(row.created_at)} · Topic: {row.category}</p>
        <h1 className="font-serif font-bold text-3xl md:text-4xl mb-6 break-words">Report for {row.domain}</h1>

        {!r.reachable ? (
          <div className="card !p-8">
            <h2 className="font-serif font-semibold text-xl mb-2">We could not read this website</h2>
            <p className="text-inksoft mb-5">{WHY_UNREACHABLE[r.unreachableReason ?? ""] ?? "Something stopped us from reading the homepage."} Please check the address and try again.</p>
            <CheckForm defaultDomain={row.domain} defaultCategory={row.category} id="retry" />
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-3 gap-4 mb-10">
              <div className="rounded-lg border border-verdigris bg-[#E4EEEA] p-5"><div className="text-xs text-inksoft">In good shape</div><div className="font-mono text-3xl">{r.summary.good}<span className="text-lg text-inksoft"> of {r.summary.total}</span></div><div className="text-xs text-inksoft mt-1">Calculated from what we observed</div></div>
              <div className="rounded-lg border border-amber bg-[#FBEBDA] p-5"><div className="text-xs text-inksoft">Worth a look</div><div className="font-mono text-3xl">{improve.length}</div><div className="text-xs text-inksoft mt-1">Small things you can usually fix yourself</div></div>
              <div className="rounded-lg border border-line bg-white p-5"><div className="text-xs text-inksoft">Pages we read</div><div className="font-mono text-3xl">{1 + r.pages.length}</div><div className="text-xs text-inksoft mt-1">Observed</div></div>
            </div>

            {!r.technical && good.length > 0 && (
              <div className="mb-8">
                <h2 className="font-serif font-semibold text-xl mb-3">What is already working</h2>
                <ul className="flex flex-wrap gap-2">{good.map((g) => <li key={g.id} title={g.detail} className="status-verified rounded-full px-3 py-1.5 text-sm">✓ {g.label}</li>)}</ul>
              </div>
            )}

            {!r.technical && improve.length > 0 && (
              <div className="mb-10">
                <h2 className="font-serif font-semibold text-xl mb-3">Worth improving</h2>
                <ul className="grid gap-3">{improve.map((c) => (
                  <li key={c.id} className="card flex gap-4"><span aria-hidden className="mt-0.5 text-amber">●</span><div><div className="font-medium">{c.label}</div><p className="text-sm text-inksoft">{c.detail}</p></div></li>))}</ul>
              </div>
            )}

            {r.pages.length > 0 && (
              <details className="mb-10 card">
                <summary className="cursor-pointer font-medium">Pages we read ({r.pages.length + 1})</summary>
                <ul className="mt-4 grid gap-2 text-sm">
                  <li className="flex flex-wrap justify-between gap-2"><span className="break-all">{r.home?.finalUrl}</span><span className="text-inksoft">{r.home?.status}</span></li>
                  {r.pages.map((p) => <li key={p.url} className="flex flex-wrap justify-between gap-2 border-t border-line pt-2"><span className="break-all">{p.title ?? p.url}<span className="block text-xs text-inksoft">{p.url}</span></span><span className="text-inksoft">{p.status ?? "No response"}{p.noindex ? " · noindex" : ""}</span></li>)}
                </ul>
              </details>
            )}

            <SeoReport technical={r.technical} seo={r.seo} checkId={row.id} publishers={(pubs ?? []).map((p: any) => ({ websiteId: p.id, domain: p.domain }))} />
            <p className="text-xs text-inksoft mb-12">Report generated {fmtDateTime(row.created_at)}. Reports are kept for 30 days; checking the same site again within 6 hours reuses this one, and third-party data is refreshed on a new check once it is older than the configured cache window.</p>
          </>
        )}

        {r.reachable && (
          <div id="publishers">
            <h2 className="font-serif font-bold text-2xl mb-1">Publishers that fit {row.category.toLowerCase()} sites</h2>
            <p className="text-inksoft mb-6">Options, not promises. A placement is a link opportunity; search engines decide what it is worth.</p>
            {ranked.length === 0 ? (
              <div className="card"><strong className="font-serif block mb-1">No approved publisher covers this topic yet</strong><span className="text-sm text-inksoft">Tell us what you need and we will look for options. <Link className="underline text-accenttext" href="/contact">Contact the team</Link>.</span></div>
            ) : (
              <ul className="grid md:grid-cols-2 gap-4">{ranked.map(({ candidate: c, match }) => (
                <li key={c.websiteId} className="card flex flex-col">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-serif font-semibold text-lg break-all">{c.domain}</div><div className="text-xs text-inksoft">{c.niche ?? "General"}{c.country ? ` · ${c.country}` : ""}</div></div><div className="text-right shrink-0"><Money value={c.priceGuestPost ?? c.priceLinkInsertion} /><div className="text-xs text-inksoft">{c.priceGuestPost != null ? "guest post" : "link insertion"}</div></div></div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {c.metrics?.verified && c.metrics.dr != null ? <StatusBadge status="VERIFIED" label={`DR ${c.metrics.dr} (verified)`} /> : <StatusBadge status="NEEDS_REVIEW" label="Authority not verified" />}
                    {c.linkType && <StatusBadge status={c.linkType === "dofollow" ? "VERIFIED" : "NEEDS_REVIEW"} label={c.linkType} />}
                    {c.turnaroundMax != null && <StatusBadge status="NEEDS_REVIEW" label={`Up to ${c.turnaroundMax} days`} />}
                  </div>
                  <p className="text-sm mt-3 flex-1">{explainMatch(match)}</p>
                  <div className="flex flex-wrap gap-3 mt-4">
                    <Link className="btn-primary" href={`/dashboard/start?check=${row.id}&publisher=${c.websiteId}`}>Order this placement</Link>
                    <Link className="btn" href={`/publishers/${encodeURIComponent(c.domain)}`}>View details</Link>
                  </div>
                </li>))}
              </ul>
            )}
            <p className="text-sm text-inksoft mt-6">You will be asked to sign in or create an account only when you press &quot;Order this placement&quot;. <Link className="underline text-accenttext" href="/publishers">Browse all publishers</Link></p>
          </div>
        )}

        <div className="mt-14 rounded-xl border border-line bg-white p-6 md:p-8">
          <h2 className="font-serif font-semibold text-xl mb-1">Check another website</h2>
          <p className="text-sm text-inksoft mb-5">Compare your site with another one, or try a different topic.</p>
          <CheckForm id="again" />
        </div>
      </div>
    </section>
  );
}
