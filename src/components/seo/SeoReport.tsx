import Link from "next/link";
import type { Section, SeoOverview, AuthorityData, OrganicData, GapData } from "@/lib/seo/types";
import type { TechnicalReport, Finding } from "@/lib/seo/technical";
import { BarList, LineChart, countryName, fmtNum } from "@/components/seo/charts";
import { fmtDateTime } from "@/components/ui";

type MarketPublisher = { websiteId: string; domain: string };

const KIND_TAG = {
  index: "Provider index data",
  estimate: "Estimate",
  observed: "Observed by PostAtlas",
  calculated: "Calculated"
} as const;

function Tag({ kind }: { kind: keyof typeof KIND_TAG }) {
  const tone = kind === "observed" ? "status-verified" : "border border-line bg-white";
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] ${tone}`}>{KIND_TAG[kind]}</span>;
}

function Stat({ label, value, kind, hint }: { label: string; value: React.ReactNode; kind: keyof typeof KIND_TAG; hint?: string }) {
  const missing = value === null || value === undefined || value === "—";
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="text-xs text-inksoft">{label}</div>
      <div className={`font-mono text-2xl ${missing ? "text-inksoft" : ""}`}>{missing ? "—" : value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-inksoft">{missing ? <span>Not returned by the provider</span> : <Tag kind={kind} />}{hint ? <span>{hint}</span> : null}</div>
    </div>
  );
}

const WHY: Record<string, string> = {
  no_provider: "No third-party SEO data provider is connected to this PostAtlas installation, so these figures are not shown. We never substitute a guess for them. An administrator can connect a provider (see docs/SEO_DATA.md).",
  plan_or_key: "The connected provider refused the request. The API key may be invalid or the provider plan may not include this data.",
  rate_limited: "The data provider is limiting requests right now. Run the check again a little later.",
  timeout: "The data provider did not answer in time. Run the check again later.",
  provider_error: "The data provider returned an error. Technical results below are unaffected.",
  not_supported: "The connected provider does not supply this metric.",
  no_data: "The provider has no data for this domain.",
  budget: "The daily limit for third-party lookups has been reached. Try again later."
};

function Unavailable({ s, title }: { s: Extract<Section<unknown>, { status: "unavailable" }>; title: string }) {
  return (
    <div className="card bg-mist" role="status">
      <h3 className="font-serif font-semibold">{title}: not available</h3>
      <p className="text-sm text-inksoft mt-1">{WHY[s.reason] ?? s.message}</p>
      {s.reason !== "no_provider" && s.message ? <p className="text-xs text-inksoft mt-1">{s.message}</p> : null}
    </div>
  );
}

function Provenance({ provider, asOf }: { provider: string; asOf: string }) {
  return <p className="text-xs text-inksoft mb-3">Source: {provider === "ahrefs" ? "Ahrefs" : provider} · data fetched {fmtDateTime(asOf)}. Domain-level (whole site) unless stated.</p>;
}

function Authority({ s }: { s: Section<AuthorityData> }) {
  if (s.status !== "ok") return <Unavailable s={s} title="Domain authority and backlinks" />;
  const a = s.value;
  if (a.drOnly && a.domainRating !== null) {
    // Free Ahrefs endpoint: Domain Rating only. Say what is not included instead of showing empty cards.
    return (
      <div>
        <p className="text-sm mb-2">Domain Rating is shown at the top of this report.</p>
        <p className="text-xs text-inksoft">Referring domains, backlink counts, history charts, traffic and keywords are not shown: they need a paid Ahrefs plan with API access. Domain Authority (Moz) comes from a different provider that is not connected.</p>
      </div>
    );
  }
  return (
    <div>
      <Provenance provider={s.provider} asOf={s.asOf} />
      {a.domainRating !== null && <p className="text-sm mb-3">Domain Rating is shown at the top of this report.</p>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        <Stat label="Referring domains (live)" value={a.referringDomains.live !== null ? fmtNum(a.referringDomains.live) : null} kind="index" />
        <Stat label="Backlinks (live)" value={a.backlinks.live !== null ? fmtNum(a.backlinks.live) : null} kind="index" />
        <Stat label="Backlinks (all time)" value={a.backlinks.allTime !== null ? fmtNum(a.backlinks.allTime) : null} kind="index" />
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="card"><h4 className="font-medium mb-2">Referring domains, last 12 months</h4><LineChart points={a.refDomainsHistory} label="Referring domains" /></div>
        <div className="card"><h4 className="font-medium mb-2">{a.domainRatingLabel}, last 12 months</h4><LineChart points={a.domainRatingHistory} label="Domain Rating" /></div>
      </div>
      <p className="text-xs text-inksoft mt-3">Domain Authority (Moz) is not shown: it comes from a different provider that is not connected. Dofollow and nofollow counts are not shown because this provider&apos;s summary endpoints do not return them.</p>
    </div>
  );
}

function Organic({ s }: { s: Section<OrganicData> }) {
  if (s.status !== "ok") return <Unavailable s={s} title="Organic search and traffic" />;
  const o = s.value;
  return (
    <div>
      <Provenance provider={s.provider} asOf={s.asOf} />
      <div className="grid sm:grid-cols-2 gap-3 mb-5">
        <Stat label="Estimated organic traffic / month" value={o.estimatedTraffic !== null ? fmtNum(o.estimatedTraffic) : null} kind="estimate" />
        <Stat label="Estimated organic keywords" value={o.estimatedKeywords !== null ? fmtNum(o.estimatedKeywords) : null} kind="estimate" />
      </div>
      <div className="grid md:grid-cols-2 gap-5 mb-5">
        <div className="card"><h4 className="font-medium mb-1">Estimated organic traffic trend <Tag kind="estimate" /></h4><LineChart points={o.trafficHistory} label="Estimated organic traffic" /></div>
        <div className="card"><h4 className="font-medium mb-2">Traffic by country <Tag kind="estimate" /></h4>
          {o.countries.length ? <BarList rows={o.countries.slice(0, 8).map((c) => ({ label: countryName(c.country), value: c.traffic ?? 0, detail: `${fmtNum(c.traffic)}${c.share !== null ? ` · ${(c.share * 100).toFixed(1)}%` : ""}` }))} /> : <p className="text-sm text-inksoft">No country breakdown returned.</p>}
        </div>
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card overflow-x-auto"><h4 className="font-medium mb-2">Top organic pages <Tag kind="estimate" /></h4>
          {o.topPages.length ? <table className="w-full text-sm"><thead><tr className="text-left text-xs text-inksoft"><th className="py-1 pr-2">Page</th><th className="py-1 pr-2">Traffic</th><th className="py-1">Keywords</th></tr></thead><tbody>{o.topPages.map((p) => <tr key={p.url} className="border-t border-line align-top"><td className="py-1.5 pr-2 break-all">{p.url}{p.topKeyword ? <span className="block text-xs text-inksoft">Top keyword: {p.topKeyword}</span> : null}</td><td className="py-1.5 pr-2 font-mono">{fmtNum(p.traffic)}</td><td className="py-1.5 font-mono">{fmtNum(p.keywords)}</td></tr>)}</tbody></table> : <p className="text-sm text-inksoft">No page data returned.</p>}
        </div>
        <div className="card overflow-x-auto"><h4 className="font-medium mb-2">Top ranking keywords <Tag kind="estimate" /></h4>
          {o.topKeywords.length ? <table className="w-full text-sm"><thead><tr className="text-left text-xs text-inksoft"><th className="py-1 pr-2">Keyword</th><th className="py-1 pr-2">Pos.</th><th className="py-1 pr-2">Volume</th><th className="py-1">Traffic</th></tr></thead><tbody>{o.topKeywords.map((k) => <tr key={k.keyword} className="border-t border-line align-top"><td className="py-1.5 pr-2">{k.keyword}{k.url ? <span className="block text-xs text-inksoft break-all">{k.url}</span> : null}</td><td className="py-1.5 pr-2 font-mono">{k.position ?? "—"}</td><td className="py-1.5 pr-2 font-mono">{fmtNum(k.volume)}</td><td className="py-1.5 font-mono">{fmtNum(k.traffic)}</td></tr>)}</tbody></table> : <p className="text-sm text-inksoft">No keyword data returned.</p>}
        </div>
      </div>
      <p className="text-xs text-inksoft mt-3">Traffic and keyword figures are the provider&apos;s modelled estimates, not your analytics. Positions are the provider&apos;s most recent observation.</p>
    </div>
  );
}

const SEV: Record<Finding["severity"], { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "border-amber bg-[#FBEBDA]" },
  warning: { label: "Warning", cls: "border-line bg-white" },
  notice: { label: "Notice", cls: "border-line bg-mist" }
};

function Technical({ t }: { t: TechnicalReport }) {
  const siteFindings = t.findings.filter((f) => f.scope === "site");
  const pageFindings = t.findings.filter((f) => f.scope === "page");
  const counts = { critical: t.findings.filter((f) => f.severity === "critical").length, warning: t.findings.filter((f) => f.severity === "warning").length, notice: t.findings.filter((f) => f.severity === "notice").length };
  return (
    <div>
      <p className="text-xs text-inksoft mb-3">Observed by PostAtlas on {fmtDateTime(t.observedAt)} by reading your public pages. Not estimates.</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Technical score" value={t.score.value} kind="calculated" hint="PostAtlas formula, 0–100" />
        <Stat label="Critical / warnings / notices" value={`${counts.critical} / ${counts.warning} / ${counts.notice}`} kind="observed" />
        <Stat label="HTTP status" value={String(t.status)} kind="observed" hint={t.https ? "HTTPS" : "Not HTTPS"} />
        <Stat label="Indexable" value={t.indexability.indexable ? "Yes" : "No"} kind="observed" hint={t.indexability.reasons.join("; ") || undefined} />
      </div>
      <details className="text-xs text-inksoft mb-5"><summary className="cursor-pointer">How the technical score is calculated</summary><p className="mt-1">{t.score.formula}</p></details>

      <div className="grid md:grid-cols-2 gap-5 mb-5">
        <div className="card text-sm grid gap-1.5">
          <h4 className="font-medium mb-1">Crawl and indexability</h4>
          <div>Final address: <span className="break-all">{t.finalUrl}</span></div>
          <div>Redirects: {t.redirects.length === 0 ? "none" : t.redirects.map((r) => `${r.status} → ${r.to}`).join(", ")}</div>
          <div>Canonical: {t.canonical.value ? <span className="break-all">{t.canonical.value}{t.canonical.matchesFinalUrl === false ? " (differs from final address)" : ""}</span> : "none found"}</div>
          <div>robots.txt: {t.robotsTxt.presence}{t.robotsTxt.blocksAllCrawlers ? " · blocks all crawlers" : ""}{t.robotsTxt.sitemapDirectives.length ? ` · ${t.robotsTxt.sitemapDirectives.length} sitemap line(s)` : ""}</div>
          <div>Sitemap: {t.sitemap.presence}{t.sitemap.entries !== null ? ` · ${t.sitemap.entries} ${t.sitemap.kind === "index" ? "sitemaps listed" : "URLs listed"}` : ""}</div>
          <div>Internal links on the homepage: {t.links.internalFound}</div>
          <div>Broken links: {t.links.sampledChecked === 0 ? "not sampled" : `${t.links.broken.length} of ${t.links.sampledChecked} sampled links (not a full crawl)`}</div>
        </div>
        <div className="card text-sm">
          <h4 className="font-medium mb-2">Homepage heading structure</h4>
          <div className="text-inksoft mb-2">H1: {t.headings.h1} · H2: {t.headings.h2} · H3: {t.headings.h3}</div>
          {t.headings.outline.length ? <ul className="grid gap-0.5">{t.headings.outline.slice(0, 14).map((h, i) => <li key={i} style={{ paddingLeft: `${(h.level - 1) * 12}px` }} className="truncate"><span className="text-[11px] text-inksoft mr-1">H{h.level}</span>{h.text}</li>)}</ul> : <p className="text-inksoft">No headings found.</p>}
        </div>
      </div>

      <h4 className="font-serif font-semibold text-lg mb-2">Findings</h4>
      {t.findings.length === 0 ? <p className="text-sm text-inksoft">No issues were found in the pages we read.</p> : (
        <ul className="grid gap-2">
          {[...siteFindings, ...pageFindings].sort((a, b) => ["critical", "warning", "notice"].indexOf(a.severity) - ["critical", "warning", "notice"].indexOf(b.severity)).map((f, i) => (
            <li key={`${f.id}-${i}`} className={`rounded-lg border p-3 text-sm ${SEV[f.severity].cls}`}>
              <div className="flex flex-wrap items-center gap-2"><span className="text-[11px] font-medium uppercase tracking-wide">{SEV[f.severity].label}</span><strong>{f.title}</strong><span className="text-[11px] text-inksoft">{f.scope === "page" ? "page" : "site"}</span></div>
              {f.url ? <div className="text-xs text-inksoft break-all">{f.url}</div> : null}
              <div className="mt-1"><span className="text-inksoft">Evidence: </span>{f.evidence}</div>
              <div><span className="text-inksoft">What to do: </span>{f.recommendation}</div>
            </li>))}
        </ul>
      )}
    </div>
  );
}

function Gap({ s, checkId, publishers }: { s: Section<GapData>; checkId: string; publishers: MarketPublisher[] }) {
  if (s.status !== "ok") return <Unavailable s={s} title="Backlink gap and link opportunities" />;
  const g = s.value;
  const byDomain = new Map(publishers.map((p) => [p.domain.replace(/^www\./, ""), p]));
  return (
    <div>
      <Provenance provider={s.provider} asOf={s.asOf} />
      <p className="text-sm mb-1">Compared with the closest organic competitor the provider found: <strong>{g.competitor}</strong>.</p>
      <p className="text-xs text-inksoft mb-3">{g.note} <Tag kind="calculated" /></p>
      <div className="card overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-inksoft"><th className="py-1 pr-2">Domain linking to the competitor, not to you</th><th className="py-1 pr-2">DR</th><th className="py-1 pr-2">Links to competitor</th><th className="py-1"></th></tr></thead>
        <tbody>{g.opportunities.map((o) => { const pub = byDomain.get(o.domain.replace(/^www\./, "")); return (
          <tr key={o.domain} className="border-t border-line"><td className="py-1.5 pr-2 break-all">{o.domain}</td><td className="py-1.5 pr-2 font-mono">{o.domainRating !== null ? Math.round(o.domainRating) : "—"}</td><td className="py-1.5 pr-2 font-mono">{fmtNum(o.linksToCompetitor)}</td>
            <td className="py-1.5 text-right">{pub ? <Link className="btn-primary" href={`/dashboard/start?check=${checkId}&publisher=${pub.websiteId}`}>Order on PostAtlas</Link> : <span className="text-xs text-inksoft">Not a PostAtlas publisher</span>}</td></tr>); })}</tbody></table></div>
      <p className="text-xs text-inksoft mt-2">Next step: where a domain is a PostAtlas publisher you can order a placement directly. For others, use the publisher list below to find sites in your topic.</p>
    </div>
  );
}

export function SeoReport({ technical, seo, checkId, publishers }: { technical?: TechnicalReport; seo?: SeoOverview; checkId: string; publishers: MarketPublisher[] }) {
  return (
    <div className="grid gap-12 mb-12">
      <section aria-labelledby="sec-authority">
        <h2 id="sec-authority" className="font-serif font-bold text-2xl mb-1">Domain authority and backlinks</h2>
        <p className="text-sm text-inksoft mb-3">Third-party index data. Not something a crawl of your homepage can produce.</p>
        {seo ? <Authority s={seo.authority} /> : <div className="card bg-mist text-sm text-inksoft">This report was created before third-party metrics were added. Run a new check to include them (when a provider is connected).</div>}
      </section>
      <section aria-labelledby="sec-organic">
        <h2 id="sec-organic" className="font-serif font-bold text-2xl mb-1">Organic search and traffic</h2>
        {seo ? <Organic s={seo.organic} /> : <div className="card bg-mist text-sm text-inksoft">Not included in this older report. Run a new check.</div>}
      </section>
      <section aria-labelledby="sec-technical">
        <h2 id="sec-technical" className="font-serif font-bold text-2xl mb-1">Technical SEO and indexability</h2>
        {technical ? <Technical t={technical} /> : <div className="card bg-mist text-sm text-inksoft">This report predates the detailed technical report. Run a new check for headings, redirects, canonical, indexability and findings.</div>}
      </section>
      <section aria-labelledby="sec-gap">
        <h2 id="sec-gap" className="font-serif font-bold text-2xl mb-1">Backlink gap and opportunities</h2>
        {seo ? <Gap s={seo.gap} checkId={checkId} publishers={publishers} /> : <div className="card bg-mist text-sm text-inksoft">Not included in this older report. Run a new check.</div>}
      </section>
    </div>
  );
}
