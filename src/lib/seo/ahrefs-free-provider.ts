// SeoOverviewProvider backed ONLY by Ahrefs' free Domain Rating endpoint. Traffic, keywords, backlinks and gap data need the paid
// API, so those sections say so instead of showing anything made up.
import type { SeoOverview, SeoOverviewProvider } from "./types.ts";
import { unavailableOverview } from "./types.ts";
import { fetchFreeDomainRating } from "./ahrefs-free.ts";

export function createAhrefsFreeProvider(cfg: { apiKey: string | undefined; fetchImpl?: Parameters<typeof fetchFreeDomainRating>[1]["fetchImpl"]; now?: () => Date; timeoutMs?: number }): SeoOverviewProvider {
  const now = cfg.now ?? (() => new Date());
  return {
    id: "ahrefs-free", label: "Ahrefs (free Domain Rating)",
    isConfigured: () => !!cfg.apiKey,
    async fetchOverview(domain) {
      if (!cfg.apiKey) return unavailableOverview("ahrefs-free", "Ahrefs (free Domain Rating)", "no_provider", "No Ahrefs API key is configured.", now());
      const authority = await fetchFreeDomainRating(domain, cfg);
      const paid = { status: "unavailable", reason: "not_supported", message: "This needs a paid Ahrefs plan with API access. The free key provides Domain Rating only." } as const;
      return { provider: "ahrefs-free", providerLabel: "Ahrefs (free Domain Rating)", fetchedAt: now().toISOString(), authority, organic: paid, gap: paid } satisfies SeoOverview;
    }
  };
}
