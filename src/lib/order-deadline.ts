// Pure rules for the order completion deadline (unit-tested; no React, no database).
//
// The clock starts when the publisher ACCEPTS an order (the database stamps `accepted_at` and `due_at` inside
// transition_order()). The window is `turnaround_hours`, snapshotted from the listing's stated turnaround when the order was
// placed, so a publisher editing their listing later cannot move a deadline the customer already relied on.
// The database enforces the same rules (request_expiry_remedy() re-checks them); this module is what pages and the cron use
// to describe them.
import type { OrderStatus } from "./types.ts";

/** A listing that states no turnaround gets this many days. Mirrors public.turnaround_hours_for() in SQL (a test checks it). */
export const DEFAULT_TURNAROUND_DAYS = 7;
export const turnaroundHoursFor = (daysMax: number | null | undefined): number => (daysMax == null ? DEFAULT_TURNAROUND_DAYS : daysMax) * 24;

/** Statuses in which the publisher owes delivery and the clock matters. Once PUBLISHED the clock no longer applies. */
export const CLOCK_STATUSES: readonly OrderStatus[] = ["ACCEPTED", "IN_PROGRESS"];

export type DeadlineInput = { status: string; due_at: string | null | undefined };
export type DeadlineState =
  | { kind: "none" }                                           // no clock (not accepted yet, already delivered, closed...)
  | { kind: "running"; dueAt: string; msLeft: number }
  | { kind: "overdue"; dueAt: string; msLate: number };

export function deadlineState(o: DeadlineInput, now: number = Date.now()): DeadlineState {
  if (!o.due_at || !(CLOCK_STATUSES as readonly string[]).includes(o.status)) return { kind: "none" };
  const due = Date.parse(o.due_at);
  if (Number.isNaN(due)) return { kind: "none" };
  return due > now ? { kind: "running", dueAt: o.due_at, msLeft: due - now } : { kind: "overdue", dueAt: o.due_at, msLate: now - due };
}

/** True when the customer may now ask for a refund or an alternative placement. */
export const canRequestExpiryRemedy = (o: DeadlineInput, now: number = Date.now()): boolean => deadlineState(o, now).kind === "overdue";

export const EXPIRY_CHOICES = ["refund", "alternative"] as const;
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number];

/** "48 hours", "3 days", "3 days 4 hours". */
export function formatHours(hours: number): string {
  const h = Math.max(0, Math.round(hours));
  if (h <= 48) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.floor(h / 24), r = h % 24;
  return `${d} day${d === 1 ? "" : "s"}${r ? ` ${r} hour${r === 1 ? "" : "s"}` : ""}`;
}

/** "1 day 4 hours", "3 hours 20 minutes", "12 minutes". Never negative. */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(totalMin / 1440), h = Math.floor((totalMin % 1440) / 60), m = totalMin % 60;
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (d > 0) return h ? `${part(d, "day")} ${part(h, "hour")}` : part(d, "day");
  if (h > 0) return m ? `${part(h, "hour")} ${part(m, "minute")}` : part(h, "hour");
  return part(m, "minute");
}

/** Customer-facing label for an order a publisher declined OR whose deadline the customer closed out. */
export function closedOrderLabel(status: string, expiryChoice: string | null | undefined): string | null {
  if (status !== "PUBLISHER_REJECTED" || !expiryChoice) return null;
  return expiryChoice === "refund" ? "Deadline missed: refund requested" : "Deadline missed: finding another publisher";
}

/** Deterministic (always UTC) so server-rendered text, emails and tests agree: "Oct 18, 2026, 2:05 PM UTC". */
export const formatDueUtc = (iso: string): string => `${new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
