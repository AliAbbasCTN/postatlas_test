import type { OrderStatus } from "./types.ts";

// Groups of order statuses used by the "tabs" on the Orders lists. Every status belongs to exactly one group
// (a test enforces this), so a tab can never hide an order that "All" shows.
export type OrderGroup<K extends string> = { key: K; label: string; statuses: OrderStatus[] };

export type CustomerGroupKey = "action" | "progress" | "live" | "closed";
export const CUSTOMER_GROUPS: OrderGroup<CustomerGroupKey>[] = [
  { key: "action", label: "Needs your action", statuses: ["PAYMENT_PENDING", "PAID", "ISSUE_DETECTED"] },
  { key: "progress", label: "In progress", statuses: ["PAYMENT_UNDER_REVIEW", "CONTENT_SUBMITTED", "PENDING_PUBLISHER", "ACCEPTED", "IN_PROGRESS", "PUBLISHED", "VERIFICATION_PENDING", "REPLACEMENT_REQUESTED", "DISPUTED"] },
  { key: "live", label: "Live and completed", statuses: ["VERIFIED", "MONITORING", "COMPLETED"] },
  { key: "closed", label: "Closed", statuses: ["CANCELLED", "PUBLISHER_REJECTED"] }
];

// Only statuses a publisher is ever allowed to see (orders reach a publisher after payment approval and article review).
export type PublisherGroupKey = "answer" | "progress" | "done" | "declined";
export const PUBLISHER_GROUPS: OrderGroup<PublisherGroupKey>[] = [
  { key: "answer", label: "Waiting for your answer", statuses: ["PENDING_PUBLISHER"] },
  { key: "progress", label: "In progress", statuses: ["ACCEPTED", "IN_PROGRESS", "PUBLISHED", "VERIFICATION_PENDING", "ISSUE_DETECTED", "REPLACEMENT_REQUESTED", "DISPUTED"] },
  { key: "done", label: "Verified and completed", statuses: ["VERIFIED", "MONITORING", "COMPLETED"] },
  { key: "declined", label: "Declined", statuses: ["PUBLISHER_REJECTED"] }
];

export const PUBLISHER_VISIBLE_STATUSES: OrderStatus[] = PUBLISHER_GROUPS.flatMap((g) => g.statuses);

// Unknown or missing input means "All" (empty string); a value can never select a status outside the groups.
export function parseGroup<K extends string>(value: string | undefined, groups: OrderGroup<K>[]): K | "" {
  return groups.find((g) => g.key === value)?.key ?? "";
}
export function statusesOf<K extends string>(key: K | "", groups: OrderGroup<K>[], allowed?: OrderStatus[]): OrderStatus[] {
  const list = key ? groups.find((g) => g.key === key)?.statuses ?? [] : groups.flatMap((g) => g.statuses);
  return allowed ? list.filter((s) => allowed.includes(s)) : list;
}
