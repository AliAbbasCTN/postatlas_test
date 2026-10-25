// Pure payout / recovery rules (unit-tested). The database enforces the same rules; this module is what the UI and
// the cron summary use to describe them.
export const PAYOUT_PROCESSING_HOURS = 12;          // target to INITIATE processing after automatic verification. Not a bank settlement promise.
export const RESTORATION_DEADLINE_HOURS = 72;       // original publisher's time to restore a missing link (override with RESTORE_DEADLINE_HOURS)
export const REJECTION_RECOVERY_HOURS = 48;         // time for admins to reassign or refund after a publisher declines a paid order
export const TIMEOUT_RECOVERY_HOURS = 48;           // same window after the customer closes out an order whose delivery deadline passed (mirrors request_expiry_remedy())

export const processByFor = (verifiedAtIso: string) => new Date(Date.parse(verifiedAtIso) + PAYOUT_PROCESSING_HOURS * 3600_000).toISOString();

export type PayoutStatus = "ELIGIBLE" | "HELD" | "PROCESSING" | "PAID" | "FAILED" | "UNCERTAIN" | "CANCELLED" | "NOT_REQUESTED" | "REQUESTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "PROCESSED";

export function isOverdue(p: { status: PayoutStatus; process_by: string | null }, now = new Date()): boolean {
  return p.status === "ELIGIBLE" && !!p.process_by && Date.parse(p.process_by) < now.getTime();
}
/** Which transitions a payout may make (mirrors the SQL functions). */
export const PAYOUT_NEXT: Record<string, string[]> = {
  ELIGIBLE: ["PROCESSING", "HELD", "CANCELLED"],
  HELD: ["ELIGIBLE", "CANCELLED"],
  PROCESSING: ["PAID", "FAILED", "UNCERTAIN"],
  UNCERTAIN: ["PAID", "FAILED"],            // reconcile only; never straight back to processing
  FAILED: ["ELIGIBLE", "HELD", "CANCELLED"], // retry goes back through the queue
  PAID: [], CANCELLED: []
};
export const canPayoutMove = (from: string, to: string) => (PAYOUT_NEXT[from] ?? []).includes(to);

export const REFUND_NEXT: Record<string, string[]> = {
  REQUESTED: ["APPROVED", "REJECTED"], APPROVED: ["PROCESSING", "REJECTED"], PROCESSING: ["COMPLETED", "FAILED", "UNCERTAIN"],
  UNCERTAIN: ["COMPLETED", "FAILED"], FAILED: ["PROCESSING"], COMPLETED: [], REJECTED: []
};
export const canRefundMove = (from: string, to: string) => (REFUND_NEXT[from] ?? []).includes(to);

/** Remaining refundable amount in minor units; never negative. */
export function refundableMinor(paidMinor: bigint, liveRefundsMinor: bigint): bigint {
  const r = paidMinor - liveRefundsMinor;
  return r > 0n ? r : 0n;
}
export function maskedDestination(last4: string, bank: string): string { return `${bank} •••• ${last4}`; }

export type PayoutGate = { ok: true } | { ok: false; reason: string };
/** Whether a payout may enter the processing queue. */
export function payoutGate(i: { openDispute: boolean; openRefund: boolean; hasVerifiedDestination: boolean; orderPaid: boolean }): PayoutGate {
  if (!i.orderPaid) return { ok: false, reason: "The customer's payment is not confirmed" };
  if (i.openDispute) return { ok: false, reason: "A dispute is open on this order" };
  if (i.openRefund) return { ok: false, reason: "A refund is open on this order" };
  if (!i.hasVerifiedDestination) return { ok: false, reason: "The publisher has no verified payout destination" };
  return { ok: true };
}
