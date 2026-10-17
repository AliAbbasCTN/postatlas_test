// Read helpers for PUBLIC review data. They take the anonymous (public) client, so Row Level Security decides what is
// visible: only published reviews of approved listings, and only the granted columns (no reviewer, workspace or order).
type Db = { from: (t: string) => any };

export type ListingRating = { count: number; average: number | null };

/** Rating summary for several listings at once (marketplace cards). Listings with no reviews are simply absent. */
export async function loadRatings(db: Db, listingIds: string[]): Promise<Map<string, ListingRating>> {
  const out = new Map<string, ListingRating>();
  if (listingIds.length === 0) return out;
  const { data } = await db.from("site_review_stats").select("listing_id, review_count, avg_rating").in("listing_id", listingIds);
  for (const r of (data ?? []) as { listing_id: string; review_count: number; avg_rating: number | string }[]) {
    out.set(r.listing_id, { count: Number(r.review_count), average: Number(r.avg_rating) });
  }
  return out;
}

export type PublicReview = { id: string; rating: number; comment: string | null; created_at: string };

export async function loadReviews(db: Db, listingId: string, limit = 20): Promise<PublicReview[]> {
  const { data } = await db.from("site_reviews").select("id, rating, comment, created_at").eq("listing_id", listingId).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as PublicReview[];
}
