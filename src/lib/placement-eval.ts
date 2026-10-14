import { findLink, extractPageSignals, type LinkAttribute } from "./link-check.ts";

// Decides what a single fetch of a published page means. Pure: the caller
// supplies what the network layer observed. Nothing here can claim a page is
// indexed - we only report what the HTML and HTTP response actually showed.

export type FetchOutcome =
  | {
      kind: "ok"; status: number; finalUrl: string; html: string; responseMs: number;
      /** Observed redirect hops before the final response (empty when there was none). Optional so older callers and fixtures are unaffected. */
      redirects?: { from: string; to: string; status: number }[];
      /** A few response headers relevant to indexability. */
      headers?: { xRobotsTag: string | null; contentType: string | null };
    }
  | { kind: "unreachable"; reason: "timeout" | "dns" | "blocked" | "connection" | "too_large" | "not_html" | "too_many_redirects" };

export type CheckStatus =
  | "VERIFIED"
  | "LINK_MISSING"
  | "LINK_CHANGED"
  | "PAGE_UNAVAILABLE"
  | "REQUIRES_REVIEW";

export type CheckExpectation = {
  publishedUrl: string;
  targetUrl: string;
  anchorText?: string | null;
  // 'dofollow' means we expect no restrictive rel; 'nofollow' / 'mixed' / null mean no expectation
  linkType?: "dofollow" | "nofollow" | "mixed" | null;
};

export type CheckResult = {
  status: CheckStatus;
  reason: string;            // short machine-readable reason
  message: string;           // plain-language explanation for the customer
  httpStatus: number | null;
  linkFound: boolean | null;
  anchorMatched: boolean | null;
  attribute: LinkAttribute | null;
  finalUrl: string | null;
  redirectedOffSite: boolean;
  noindexDetected: boolean;
  responseMs: number | null;
  transient: boolean;        // true when a retry could plausibly change the outcome
};

const base: Omit<CheckResult, "status" | "reason" | "message"> = {
  httpStatus: null, linkFound: null, anchorMatched: null, attribute: null,
  finalUrl: null, redirectedOffSite: false, noindexDetected: false, responseMs: null, transient: false
};

function hostOf(u: string): string | null {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}

export function evaluateFetch(outcome: FetchOutcome, exp: CheckExpectation): CheckResult {
  if (outcome.kind === "unreachable") {
    const transient = outcome.reason === "timeout" || outcome.reason === "connection";
    const msg: Record<string, string> = {
      timeout: "The publisher's page did not respond in time.",
      dns: "The publisher's domain could not be found.",
      connection: "We could not connect to the publisher's page.",
      blocked: "This address cannot be checked by PostAtlas.",
      too_large: "The page was too large to check.",
      not_html: "The address did not return a web page.",
      too_many_redirects: "The address redirected too many times."
    };
    // 'blocked' / 'not_html' / 'too_large' are not evidence that the placement is gone.
    const inconclusive = outcome.reason === "blocked" || outcome.reason === "not_html" || outcome.reason === "too_large";
    return {
      ...base, transient,
      status: inconclusive ? "REQUIRES_REVIEW" : "PAGE_UNAVAILABLE",
      reason: outcome.reason, message: msg[outcome.reason]
    };
  }

  const { status, finalUrl, html, responseMs } = outcome;
  const common = { ...base, httpStatus: status, finalUrl, responseMs };

  if (status === 404 || status === 410) {
    return { ...common, status: "PAGE_UNAVAILABLE", reason: `http_${status}`, message: "The published page no longer exists." };
  }
  if (status >= 500) {
    return { ...common, status: "PAGE_UNAVAILABLE", reason: `http_${status}`, transient: true, message: "The publisher's site returned a server error." };
  }
  if (status === 401 || status === 403 || status === 429) {
    // Bot protection or rate limiting - we cannot conclude anything about the link.
    return { ...common, status: "REQUIRES_REVIEW", reason: `http_${status}`, transient: true, message: "The publisher's site did not allow our check. A person needs to review this." };
  }
  if (status < 200 || status >= 300) {
    return { ...common, status: "REQUIRES_REVIEW", reason: `http_${status}`, message: `The page returned an unexpected response (${status}).` };
  }

  const redirectedOffSite = hostOf(finalUrl) !== hostOf(exp.publishedUrl);
  if (redirectedOffSite) {
    return { ...common, redirectedOffSite, status: "REQUIRES_REVIEW", reason: "redirected_off_site", message: "The published address now redirects to a different website." };
  }

  const signals = extractPageSignals(html, finalUrl);
  const link = findLink(html, finalUrl, exp.targetUrl, exp.anchorText);
  const withLink = { ...common, noindexDetected: signals.noindex, linkFound: link.found, anchorMatched: link.anchorMatched, attribute: link.attribute };

  if (!link.found) {
    if (link.otherLinksToTargetDomain > 0) {
      return { ...withLink, status: "LINK_CHANGED", reason: "target_url_changed", message: "The page links to your website, but not to the page you ordered." };
    }
    return { ...withLink, status: "LINK_MISSING", reason: "link_missing", message: "We could not find your link on the page." };
  }

  // A page-wide nofollow robots directive makes every link effectively nofollow.
  const effective: LinkAttribute = signals.nofollowAll ? "nofollow" : (link.attribute ?? "dofollow");
  const finalAttr = { ...withLink, attribute: effective };

  if (exp.linkType === "dofollow" && effective !== "dofollow") {
    return { ...finalAttr, status: "LINK_CHANGED", reason: "attribute_changed", message: `The link is marked "${effective}" but this placement was sold as dofollow.` };
  }
  if (link.anchorMatched === false) {
    return { ...finalAttr, status: "LINK_CHANGED", reason: "anchor_changed", message: "The link is present, but its anchor text is different from the one you requested." };
  }
  return { ...finalAttr, status: "VERIFIED", reason: signals.noindex ? "verified_noindex_warning" : "verified",
    message: signals.noindex
      ? "The link is present. The page asks search engines not to index it, which is worth raising with the publisher."
      : "The link was found on the page as expected." };
}

// ---- monitoring decision (avoid false positives) -------------------------

export type Verdict = "ok" | "hard" | "soft" | "inconclusive";

export function classify(r: Pick<CheckResult, "status" | "transient">): Verdict {
  if (r.status === "VERIFIED") return "ok";
  if (r.status === "REQUIRES_REVIEW") return "inconclusive";
  if (r.status === "PAGE_UNAVAILABLE" && r.transient) return "soft";
  return "hard";
}

export const HARD_FAILURES_BEFORE_ISSUE = 2;
export const SOFT_FAILURES_BEFORE_ISSUE = 3;

export type MonitorState = { consecutiveFailures: number; orderIsIssue: boolean };
export type MonitorDecision = {
  nextFailures: number;
  action: "none" | "raise_issue" | "recover";
};

// A single bad fetch never raises an issue; two consecutive hard failures (or
// three soft ones such as timeouts) do. Inconclusive checks change nothing.
export function decideMonitoring(prev: MonitorState, verdict: Verdict): MonitorDecision {
  if (verdict === "inconclusive") return { nextFailures: prev.consecutiveFailures, action: "none" };
  if (verdict === "ok") {
    return { nextFailures: 0, action: prev.orderIsIssue ? "recover" : "none" };
  }
  const next = prev.consecutiveFailures + 1;
  const threshold = verdict === "hard" ? HARD_FAILURES_BEFORE_ISSUE : SOFT_FAILURES_BEFORE_ISSUE;
  return { nextFailures: next, action: !prev.orderIsIssue && next >= threshold ? "raise_issue" : "none" };
}
