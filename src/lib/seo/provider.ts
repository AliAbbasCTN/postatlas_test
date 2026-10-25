import "server-only";
import { createAhrefsProvider } from "./ahrefs";
import { createAhrefsFreeProvider } from "./ahrefs-free-provider";
import { unavailableOverview, type SeoOverviewProvider } from "./types";

// Chooses the SEO data provider from the environment. Keys are read here, on the server, and nowhere else.
//   SEO_PROVIDER = none (default) | ahrefs-free | ahrefs      AHREFS_API_KEY = <secret>
//     ahrefs-free: Ahrefs' free Domain Rating endpoint (free APIv3 key, no paid plan): shows Domain Rating only.
//     ahrefs:      the paid Site Explorer API (needs an eligible paid plan); falls back to the free DR endpoint if DR is refused.
// With "none" (or a missing key) the report still runs its own technical checks and says plainly that third-party
// metrics are not connected. To add a provider, implement SeoOverviewProvider and register it below.
export function getSeoOverviewProvider(): SeoOverviewProvider {
  const choice = (process.env.SEO_PROVIDER ?? "none").trim().toLowerCase();
  if (choice === "ahrefs-free") return createAhrefsFreeProvider({ apiKey: process.env.AHREFS_API_KEY?.trim() || undefined });
  if (choice === "ahrefs") return createAhrefsProvider({ apiKey: process.env.AHREFS_API_KEY?.trim() || undefined });
  return {
    id: "none", label: "No provider", isConfigured: () => false,
    async fetchOverview() {
      return unavailableOverview("none", "No provider", "no_provider", "No SEO data provider is connected, so DR, DA, backlinks, traffic and keyword rankings are not shown.");
    }
  };
}
