
import Link from "next/link";
import type {
  Section,
  SeoOverview,
  AuthorityData,
  OrganicData,
  GapData
} from "@/lib/seo/types";
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
  const tone =
    kind === "observed"
      ? "status-verified"
      : "border border-line bg-white text-inksoft";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${tone}`}
    >
      {KIND_TAG[kind]}
    </span>
  );
}

function Stat({
  label,
  value,
  kind,
  hint
}: {
  label: string;
  value: React.ReactNode;
  kind: keyof typeof KIND_TAG;
  hint?: string;
}) {
  const missing =
    value === null ||
    value === undefined ||
    value === "—";

  return (
    <div className="rounded-xl border border-line bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="text-sm font-medium text-inksoft">
          {label}
        </div>

        {missing ? (
          <span className="rounded-full border border-line bg-mist px-2 py-1 text-[10px] font-medium text-inksoft">
            Unavailable
          </span>
        ) : (
          <Tag kind={kind} />
        )}
      </div>

      <div
        className={`break-words font-mono text-3xl font-semibold tracking-tight ${
          missing ? "text-inksoft" : "text-ink"
        }`}
      >
        {missing ? "—" : value}
      </div>

      <div className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-inksoft">
        {missing
          ? "This metric was not returned by the connected provider."
          : hint || "Latest available data"}
      </div>
    </div>
  );
}

const WHY: Record<string, string> = {
  no_provider:
    "No third-party SEO data provider is connected to this PostAtlas installation, so these figures are not shown. We never substitute a guess for them. An administrator can connect a provider (see docs/SEO_DATA.md).",
  plan_or_key:
    "The connected provider refused the request. The API key may be invalid or the provider plan may not include this data.",
  rate_limited:
    "The data provider is limiting requests right now. Run the check again a little later.",
  timeout:
    "The data provider did not answer in time. Run the check again later.",
  provider_error:
    "The data provider returned an error. Technical results below are unaffected.",
  not_supported:
    "The connected provider does not supply this metric.",
  no_data:
    "The provider has no data for this domain.",
  budget:
    "The daily limit for third-party lookups has been reached. Try again later."
};

function Unavailable({
  s,
  title
}: {
  s: Extract<Section<unknown>, { status: "unavailable" }>;
  title: string;
}) {
  return (
    <div
      className="rounded-xl border border-line bg-mist p-5 sm:p-6"
      role="status"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-white text-lg text-inksoft">
          i
        </div>

        <div>
          <h3 className="font-semibold">
            {title}
            <span className="font-normal text-inksoft">
              {" "}
              · Not available
            </span>
          </h3>

          <p className="mt-2 text-sm leading-6 text-inksoft">
            {WHY[s.reason] ?? s.message}
          </p>

          {s.reason !== "no_provider" && s.message ? (
            <p className="mt-2 text-xs leading-5 text-inksoft">
              {s.message}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Provenance({
  provider,
  asOf
}: {
  provider: string;
  asOf: string;
}) {
  return (
    <p className="mb-4 text-xs leading-5 text-inksoft">
      Source: {provider === "ahrefs" ? "Ahrefs" : provider} · Data
      fetched {fmtDateTime(asOf)}. Domain-level (whole site) unless
      stated.
    </p>
  );
}

function DomainRatingCard({
  value,
  label
}: {
  value: number | null;
  label: string;
}) {
  const score =
    value === null || !Number.isFinite(value)
      ? null
      : Math.max(0, Math.min(100, value));

  const angle = score === null ? 0 : score * 3.6;

  const scoreDescription =
    score === null
      ? "No score available"
      : score >= 70
        ? "Strong domain rating"
        : score >= 40
          ? "Moderate domain rating"
          : score >= 20
            ? "Developing domain rating"
            : "Low domain rating";

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
      <div className="border-b border-line px-5 py-4 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-inksoft">
              {label}
            </p>

            <h3 className="mt-1 font-serif text-xl font-bold">
              Website authority
            </h3>

            <p className="mt-1 text-xs text-inksoft">
              Ahrefs domain-level metric
            </p>
          </div>

          <Tag kind="index" />
        </div>
      </div>

      <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[180px_1fr] md:items-center">
        <div className="flex justify-center">
          <div
            className="relative grid h-40 w-40 place-items-center rounded-full"
            style={{
              background:
                score === null
                  ? "conic-gradient(#e5e7eb 0deg 360deg)"
                  : `conic-gradient(#2563eb 0deg ${angle}deg, #e5e7eb ${angle}deg 360deg)`
            }}
            role="img"
            aria-label={
              score === null
                ? "Domain Rating unavailable"
                : `Domain Rating ${Math.round(score)} out of 100`
            }
          >
            <div className="absolute inset-3 flex flex-col items-center justify-center rounded-full bg-white">
              <span className="font-mono text-5xl font-bold tracking-tight text-ink">
                {score === null ? "—" : Math.round(score)}
              </span>

              <span className="mt-1 text-xs text-inksoft">
                out of 100
              </span>
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-lg font-semibold">
            {scoreDescription}
          </h4>

          <p className="mt-2 text-sm leading-6 text-inksoft">
            Domain Rating (DR) estimates the strength of a website&apos;s
            backlink profile using Ahrefs&apos; 0–100 scale. It is not a
            Google ranking score and does not guarantee search traffic
            or rankings.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-line bg-mist p-3">
              <p className="text-xs text-inksoft">Data source</p>
              <p className="mt-1 text-sm font-semibold">Ahrefs</p>
            </div>

            <div className="rounded-lg border border-line bg-mist p-3">
              <p className="text-xs text-inksoft">Score range</p>
              <p className="mt-1 text-sm font-semibold">0–100</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Authority({ s }: { s: Section<AuthorityData> }) {
  if (s.status !== "ok") {
    return (
      <Unavailable
        s={s}
        title="Domain authority and backlinks"
      />
    );
  }

  const a = s.value;

  return (
    <div>
      <Provenance provider={s.provider} asOf={s.asOf} />

      <div className="mb-5 grid gap-4">
        <DomainRatingCard
          label={a.domainRatingLabel}
          value={a.domainRating}
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat
            label="Referring domains (live)"
            value={
              a.referringDomains.live !== null
                ? fmtNum(a.referringDomains.live)
                : null
            }
            kind="index"
            hint="Unique websites linking to this domain"
          />

          <Stat
            label="Backlinks (live)"
            value={
              a.backlinks.live !== null
                ? fmtNum(a.backlinks.live)
                : null
            }
            kind="index"
            hint="Currently live links reported by the provider"
          />

          <Stat
            label="Backlinks (all time)"
            value={
              a.backlinks.allTime !== null
                ? fmtNum(a.backlinks.allTime)
                : null
            }
            kind="index"
            hint="Historical backlink total, when supplied"
          />
        </div>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
          <h4 className="mb-1 font-semibold">
            Referring domains
          </h4>

          <p className="mb-4 text-xs text-inksoft">
            Last 12 months
          </p>

          <LineChart
            points={a.refDomainsHistory}
            label="Referring domains"
          />
        </div>

        <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
          <h4 className="mb-1 font-semibold">
            {a.domainRatingLabel}
          </h4>

          <p className="mb-4 text-xs text-inksoft">
            Last 12 months
          </p>

          <LineChart
            points={a.domainRatingHistory}
            label="Domain Rating"
          />
        </div>
      </div>

      <div className="rounded-xl border border-line bg-mist p-4">
        <p className="text-sm leading-6 text-inksoft">
          <strong className="text-ink">About these metrics:</strong>{" "}
          Domain Authority (DA) is a Moz metric and is not available
          from the connected Ahrefs endpoint. Dofollow and nofollow
          counts are also not supplied by this summary endpoint.
        </p>
      </div>
    </div>
  );
}

function Organic({ s }: { s: Section<OrganicData> }) {
  if (s.status !== "ok") {
    return (
      <Unavailable
        s={s}
        title="Organic search and traffic"
      />
    );
  }

  const o = s.value;

  return (
    <div>
      <Provenance provider={s.provider} asOf={s.asOf} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <Stat
          label="Estimated organic traffic / month"
          value={
            o.estimatedTraffic !== null
              ? fmtNum(o.estimatedTraffic)
              : null
          }
          kind="estimate"
          hint="Estimated monthly visits from organic search"
        />

        <Stat
          label="Estimated organic keywords"
          value={
            o.estimatedKeywords !== null
              ? fmtNum(o.estimatedKeywords)
              : null
          }
          kind="estimate"
          hint="Keywords estimated to bring organic visibility"
        />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
          <h4 className="font-semibold">
            Estimated organic traffic trend
          </h4>

          <div className="mb-4 mt-2">
            <Tag kind="estimate" />
          </div>

          <LineChart
            points={o.trafficHistory}
            label="Estimated organic traffic"
          />
        </div>

        <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
          <h4 className="font-semibold">Traffic by country</h4>

          <div className="mb-4 mt-2">
            <Tag kind="estimate" />
          </div>

          {o.countries.length ? (
            <BarList
              rows={o.countries.slice(0, 8).map((c) => ({
                label: countryName(c.country),
                value: c.traffic ?? 0,
                detail: `${fmtNum(c.traffic)}${
                  c.share !== null
                    ? ` · ${(c.share * 100).toFixed(1)}%`
                    : ""
                }`
              }))}
            />
          ) : (
            <p className="text-sm leading-6 text-inksoft">
              No country breakdown was returned by the provider.
            </p>
          )}
        </div>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="overflow-x-auto rounded-xl border border-line bg-white p-4 sm:p-5">
          <h4 className="font-semibold">Top organic pages</h4>

          <div className="mb-4 mt-2">
            <Tag kind="estimate" />
          </div>

          {o.topPages.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-inksoft">
                  <th className="py-2 pr-3">Page</th>
                  <th className="py-2 pr-3">Traffic</th>
                  <th className="py-2">Keywords</th>
                </tr>
              </thead>

              <tbody>
                {o.topPages.map((p) => (
                  <tr
                    key={p.url}
                    className="border-t border-line align-top"
                  >
                    <td className="break-all py-3 pr-3">
                      {p.url}

                      {p.topKeyword ? (
                        <span className="mt-1 block text-xs text-inksoft">
                          Top keyword: {p.topKeyword}
                        </span>
                      ) : null}
                    </td>

                    <td className="py-3 pr-3 font-mono">
                      {fmtNum(p.traffic)}
                    </td>

                    <td className="py-3 font-mono">
                      {fmtNum(p.keywords)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm leading-6 text-inksoft">
              No organic page data was returned.
            </p>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-line bg-white p-4 sm:p-5">
          <h4 className="font-semibold">Top ranking keywords</h4>

          <div className="mb-4 mt-2">
            <Tag kind="estimate" />
          </div>

          {o.topKeywords.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-inksoft">
                  <th className="py-2 pr-3">Keyword</th>
                  <th className="py-2 pr-3">Pos.</th>
                  <th className="py-2 pr-3">Volume</th>
                  <th className="py-2">Traffic</th>
                </tr>
              </thead>

              <tbody>
                {o.topKeywords.map((k) => (
                  <tr
                    key={k.keyword}
                    className="border-t border-line align-top"
                  >
                    <td className="py-3 pr-3">
                      {k.keyword}

                      {k.url ? (
                        <span className="mt-1 block break-all text-xs text-inksoft">
                          {k.url}
                        </span>
                      ) : null}
                    </td>

                    <td className="py-3 pr-3 font-mono">
                      {k.position ?? "—"}
                    </td>

                    <td className="py-3 pr-3 font-mono">
                      {fmtNum(k.volume)}
                    </td>

                    <td className="py-3 font-mono">
                      {fmtNum(k.traffic)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm leading-6 text-inksoft">
              No keyword data was returned.
            </p>
          )}
        </div>
      </div>

      <p className="text-xs leading-5 text-inksoft">
        Traffic and keyword figures are provider-modelled estimates,
        not your website analytics. Positions reflect the provider&apos;s
        most recent observation.
      </p>
    </div>
  );
}

const SEV: Record<
  Finding["severity"],
  { label: string; cls: string }
> = {
  critical: {
    label: "Critical",
    cls: "border-amber bg-[#FBEBDA]"
  },
  warning: {
    label: "Warning",
    cls: "border-line bg-white"
  },
  notice: {
    label: "Notice",
    cls: "border-line bg-mist"
  }
};

function Technical({ t }: { t: TechnicalReport }) {
  const siteFindings = t.findings.filter(
    (f) => f.scope === "site"
  );

  const pageFindings = t.findings.filter(
    (f) => f.scope === "page"
  );

  const counts = {
    critical: t.findings.filter(
      (f) => f.severity === "critical"
    ).length,
    warning: t.findings.filter(
      (f) => f.severity === "warning"
    ).length,
    notice: t.findings.filter(
      (f) => f.severity === "notice"
    ).length
  };

  return (
    <div>
      <p className="mb-4 text-xs leading-5 text-inksoft">
        Observed by PostAtlas on {fmtDateTime(t.observedAt)} by reading
        your public pages. These are crawl observations, not third-party
        traffic estimates.
      </p>

      
<div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
  <div className="rounded-lg border border-verdigris bg-[#E4EEEA] p-5 transition-shadow hover:shadow-sm">
    <div className="text-xs font-medium text-inksoft">
      Technical score
    </div>
    <div className="mt-2 font-mono text-3xl font-semibold tracking-tight text-ink">
      {t.score.value}
      <span className="ml-1 text-base font-normal text-inksoft">/ 100</span>
    </div>
    <div className="mt-1 text-xs leading-relaxed text-inksoft">
      PostAtlas formula, 0–100
    </div>
  </div>

  <div className="rounded-lg border border-amber bg-[#FBEBDA] p-5 transition-shadow hover:shadow-sm">
    <div className="text-xs font-medium text-inksoft">
      Critical / warnings / notices
    </div>
    <div className="mt-2 flex items-baseline gap-2 font-mono text-3xl font-semibold tracking-tight text-ink">
      <span>{counts.critical}</span>
      <span className="text-lg font-normal text-inksoft">/</span>
      <span>{counts.warning}</span>
      <span className="text-lg font-normal text-inksoft">/</span>
      <span>{counts.notice}</span>
    </div>
    <div className="mt-1 text-xs leading-relaxed text-inksoft">
      Observed by PostAtlas
    </div>
  </div>

  <div className="rounded-lg border border-line bg-white p-5 transition-shadow hover:shadow-sm">
    <div className="text-xs font-medium text-inksoft">
      HTTP status
    </div>
    <div className="mt-2 font-mono text-3xl font-semibold tracking-tight text-ink">
      {String(t.status)}
    </div>
    <div className="mt-1 text-xs leading-relaxed text-inksoft">
      {t.https ? "HTTPS enabled" : "Not HTTPS"}
    </div>
  </div>

  <div className="rounded-lg border border-line bg-white p-5 transition-shadow hover:shadow-sm">
    <div className="text-xs font-medium text-inksoft">
      Indexable
    </div>
    <div className="mt-2 font-mono text-3xl font-semibold tracking-tight text-ink">
      {t.indexability.indexable ? "Yes" : "No"}
    </div>
    <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-inksoft">
      {t.indexability.reasons.join("; ") || "Latest available data"}
    </div>
  </div>
</div>


      <details className="mb-5 rounded-xl border border-line bg-white p-4 text-sm">
        <summary className="cursor-pointer font-medium">
          How the technical score is calculated
        </summary>

        <p className="mt-3 leading-6 text-inksoft">
          {t.score.formula}
        </p>
      </details>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-white p-5">
          <h4 className="mb-4 font-semibold">
            Crawl and indexability
          </h4>

          <div className="grid gap-3 text-sm">
            <div>
              <span className="text-inksoft">Final address</span>
              <p className="mt-1 break-all">{t.finalUrl}</p>
            </div>

            <div>
              <span className="text-inksoft">Redirects</span>
              <p className="mt-1 break-words">
                {t.redirects.length === 0
                  ? "None"
                  : t.redirects
                      .map((r) => `${r.status} → ${r.to}`)
                      .join(", ")}
              </p>
            </div>

            <div>
              <span className="text-inksoft">Canonical URL</span>
              <p className="mt-1 break-all">
                {t.canonical.value
                  ? `${t.canonical.value}${
                      t.canonical.matchesFinalUrl === false
                        ? " (differs from final address)"
                        : ""
                    }`
                  : "None found"}
              </p>
            </div>

            <div>
              <span className="text-inksoft">robots.txt</span>
              <p className="mt-1">
                {t.robotsTxt.presence}
                {t.robotsTxt.blocksAllCrawlers
                  ? " · Blocks all crawlers"
                  : ""}
                {t.robotsTxt.sitemapDirectives.length
                  ? ` · ${t.robotsTxt.sitemapDirectives.length} sitemap line(s)`
                  : ""}
              </p>
            </div>

            <div>
              <span className="text-inksoft">Sitemap</span>
              <p className="mt-1">
                {t.sitemap.presence}
                {t.sitemap.entries !== null
                  ? ` · ${t.sitemap.entries} ${
                      t.sitemap.kind === "index"
                        ? "sitemaps listed"
                        : "URLs listed"
                    }`
                  : ""}
              </p>
            </div>

            <div>
              <span className="text-inksoft">
                Internal links on homepage
              </span>
              <p className="mt-1">{t.links.internalFound}</p>
            </div>

            <div>
              <span className="text-inksoft">Broken links</span>
              <p className="mt-1">
                {t.links.sampledChecked === 0
                  ? "Not sampled"
                  : `${t.links.broken.length} of ${t.links.sampledChecked} sampled links (not a full crawl)`}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-white p-5">
          <h4 className="mb-3 font-semibold">
            Homepage heading structure
          </h4>

          <div className="mb-4 flex flex-wrap gap-2">
            {[
              { label: "H1", value: t.headings.h1 },
              { label: "H2", value: t.headings.h2 },
              { label: "H3", value: t.headings.h3 }
            ].map((heading) => (
              <div
                key={heading.label}
                className="min-w-[76px] rounded-lg border border-line bg-mist px-3 py-2"
              >
                <p className="text-xs text-inksoft">
                  {heading.label}
                </p>

                <p className="mt-1 font-mono text-xl font-semibold">
                  {heading.value}
                </p>
              </div>
            ))}
          </div>

          {t.headings.outline.length ? (
            <ul className="grid gap-2">
              {t.headings.outline.slice(0, 14).map((h, i) => (
                <li
                  key={i}
                  style={{
                    paddingLeft: `${(h.level - 1) * 12}px`
                  }}
                  className="break-words text-sm"
                >
                  <span className="mr-2 rounded border border-line bg-mist px-1.5 py-0.5 text-[10px] font-medium text-inksoft">
                    H{h.level}
                  </span>

                  {h.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-inksoft">
              No headings found.
            </p>
          )}
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h4 className="font-serif text-xl font-semibold">
            Technical findings
          </h4>

          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-amber bg-[#FBEBDA] px-2.5 py-1">
              {counts.critical} critical
            </span>

            <span className="rounded-full border border-line bg-white px-2.5 py-1">
              {counts.warning} warnings
            </span>

            <span className="rounded-full border border-line bg-mist px-2.5 py-1">
              {counts.notice} notices
            </span>
          </div>
        </div>

        {t.findings.length === 0 ? (
          <div className="rounded-xl border border-line bg-mist p-5 text-sm text-inksoft">
            No issues were found in the pages we read.
          </div>
        ) : (
          <ul className="grid gap-3">
            {[...siteFindings, ...pageFindings]
              .sort(
                (a, b) =>
                  ["critical", "warning", "notice"].indexOf(
                    a.severity
                  ) -
                  ["critical", "warning", "notice"].indexOf(
                    b.severity
                  )
              )
              .map((f, i) => (
                <li
                  key={`${f.id}-${i}`}
                  className={`rounded-xl border p-4 sm:p-5 ${SEV[f.severity].cls}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-current/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide">
                      {SEV[f.severity].label}
                    </span>

                    <strong className="text-sm">{f.title}</strong>

                    <span className="text-xs text-inksoft">
                      {f.scope === "page" ? "Page" : "Site"}
                    </span>
                  </div>

                  {f.url ? (
                    <div className="mt-2 break-all text-xs text-inksoft">
                      {f.url}
                    </div>
                  ) : null}

                  <p className="mt-3 text-sm leading-6">
                    <span className="font-medium">Evidence: </span>
                    {f.evidence}
                  </p>

                  <p className="mt-2 text-sm leading-6">
                    <span className="font-medium">Recommended action: </span>
                    {f.recommendation}
                  </p>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Gap({
  s,
  checkId,
  publishers
}: {
  s: Section<GapData>;
  checkId: string;
  publishers: MarketPublisher[];
}) {
  if (s.status !== "ok") {
    return (
      <Unavailable
        s={s}
        title="Backlink gap and link opportunities"
      />
    );
  }

  const g = s.value;

  const byDomain = new Map(
    publishers.map((p) => [
      p.domain.replace(/^www\./, ""),
      p
    ])
  );

  return (
    <div>
      <Provenance provider={s.provider} asOf={s.asOf} />

      <div className="mb-4 rounded-xl border border-line bg-white p-5">
        <p className="text-sm text-inksoft">
          Closest organic competitor identified
        </p>

        <h4 className="mt-1 break-all font-serif text-xl font-bold">
          {g.competitor}
        </h4>

        <p className="mt-3 text-sm leading-6 text-inksoft">
          {g.note}
        </p>

        <div className="mt-3">
          <Tag kind="calculated" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="bg-mist">
            <tr className="text-left text-xs text-inksoft">
              <th className="px-4 py-3 pr-3">
                Linking domain
              </th>

              <th className="px-4 py-3 pr-3">DR</th>

              <th className="px-4 py-3 pr-3">
                Links to competitor
              </th>

              <th className="px-4 py-3 text-right">
                Opportunity
              </th>
            </tr>
          </thead>

          <tbody>
            {g.opportunities.map((o) => {
              const pub = byDomain.get(
                o.domain.replace(/^www\./, "")
              );

              return (
                <tr
                  key={o.domain}
                  className="border-t border-line align-middle"
                >
                  <td className="break-all px-4 py-3 pr-3 font-medium">
                    {o.domain}
                  </td>

                  <td className="px-4 py-3 pr-3 font-mono">
                    {o.domainRating !== null
                      ? Math.round(o.domainRating)
                      : "—"}
                  </td>

                  <td className="px-4 py-3 pr-3 font-mono">
                    {fmtNum(o.linksToCompetitor)}
                  </td>

                  <td className="px-4 py-3 text-right">
                    {pub ? (
                      <Link
                        className="btn-primary inline-block whitespace-nowrap"
                        href={`/dashboard/start?check=${encodeURIComponent(checkId)}&publisher=${encodeURIComponent(pub.websiteId)}`}
                      >
                        Order on PostAtlas
                      </Link>
                    ) : (
                      <span className="text-xs text-inksoft">
                        Not a PostAtlas publisher
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-5 text-inksoft">
        Where a domain is a PostAtlas publisher, you can order a
        placement directly. For other domains, explore the publisher
        marketplace to find relevant websites.
      </p>
    </div>
  );
}

function ReportSection({
  id,
  title,
  description,
  children
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="min-w-0 scroll-mt-8"
    >
      <div className="mb-5 border-b border-line pb-4">
        <h2
          id={id}
          className="font-serif text-2xl font-bold tracking-tight sm:text-3xl"
        >
          {title}
        </h2>

        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-inksoft">
            {description}
          </p>
        ) : null}
      </div>

      {children}
    </section>
  );
}

export function SeoReport({
  technical,
  seo,
  checkId,
  publishers
}: {
  technical?: TechnicalReport;
  seo?: SeoOverview;
  checkId: string;
  publishers: MarketPublisher[];
}) {
  return (
    <div className="mb-12 grid min-w-0 gap-10 sm:gap-12">
      <ReportSection
        id="sec-authority"
        title="Domain authority and backlinks"
        description="Understand your website's backlink authority using third-party index data. These metrics cannot be calculated from a homepage crawl alone."
      >
        {seo ? (
          <Authority s={seo.authority} />
        ) : (
          <div className="rounded-xl border border-line bg-mist p-5 text-sm leading-6 text-inksoft">
            This report was created before third-party metrics were
            added. Run a new check to include them when a provider is
            connected.
          </div>
        )}
      </ReportSection>

      <ReportSection
        id="sec-organic"
        title="Organic search and traffic"
        description="Review estimated search visibility, traffic trends, keyword data, and the countries contributing to organic visits."
      >
        {seo ? (
          <Organic s={seo.organic} />
        ) : (
          <div className="rounded-xl border border-line bg-mist p-5 text-sm leading-6 text-inksoft">
            Organic search metrics are not included in this older
            report. Run a new check to request available data.
          </div>
        )}
      </ReportSection>

      <ReportSection
        id="sec-technical"
        title="Technical SEO and indexability"
        description="Review technical observations from PostAtlas's crawl, including redirects, canonical URLs, indexability, headings, and detected issues."
      >
        {technical ? (
          <Technical t={technical} />
        ) : (
          <div className="rounded-xl border border-line bg-mist p-5 text-sm leading-6 text-inksoft">
            This report predates the detailed technical report. Run a
            new check for headings, redirects, canonical URLs,
            indexability, and findings.
          </div>
        )}
      </ReportSection>

      <ReportSection
        id="sec-gap"
        title="Backlink gap and opportunities"
        description="Discover domains linking to a competitor and identify opportunities to build relevant links through the PostAtlas marketplace."
      >
        {seo ? (
          <Gap
            s={seo.gap}
            checkId={checkId}
            publishers={publishers}
          />
        ) : (
          <div className="rounded-xl border border-line bg-mist p-5 text-sm leading-6 text-inksoft">
            Backlink gap data is not included in this older report.
            Run a new check to request available data.
          </div>
        )}
      </ReportSection>
    </div>
  );
}
