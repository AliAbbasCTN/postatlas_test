// Boundary between PostAtlas and any external SEO data source. The rest of
// the app only knows this interface. If no provider is configured, every
// metric comes back "unavailable" and the UI says so - nothing is invented.

export type ProviderValue<T> =
  | { status: "ok"; value: T; source: string; fetchedAt: string }
  | { status: "unavailable"; reason: "no_provider" | "provider_error" | "not_supported" };

export interface SeoDataProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** Referring domains observed for one page URL. */
  getReferringDomains(pageUrl: string): Promise<ProviderValue<number>>;
  /** Referring domains of comparable ranking pages, when the provider can supply them. */
  getCompetitiveReference(pageUrl: string): Promise<ProviderValue<{ referringDomains: number; sampleSize: number }>>;
}

class NoProvider implements SeoDataProvider {
  readonly name = "none";
  isConfigured() { return false; }
  async getReferringDomains(): Promise<ProviderValue<number>> { return { status: "unavailable", reason: "no_provider" }; }
  async getCompetitiveReference(): Promise<ProviderValue<{ referringDomains: number; sampleSize: number }>> {
    return { status: "unavailable", reason: "no_provider" };
  }
}

// Register real providers here (e.g. a class implementing SeoDataProvider that
// reads SEO_PROVIDER / SEO_PROVIDER_API_KEY). Until one exists, the app runs
// with NoProvider and marks link metrics as unavailable.
export function getSeoProvider(): SeoDataProvider {
  return new NoProvider();
}
