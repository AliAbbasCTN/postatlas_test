// Kept outside lib/actions/disputes.ts: a "use server" file may only export async functions.
export const DISPUTE_CATEGORIES = ["not_published", "wrong_url", "link_missing", "page_removed", "wrong_attribute", "requirements_not_followed", "publisher_failed", "changed_after_publication", "payment", "other"] as const;
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];
