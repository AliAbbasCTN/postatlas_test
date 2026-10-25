import type { OrderStatus } from "./types.ts";

// Maps the real order status onto a five-step journey the customer can read at a glance. Pure, so it is unit-tested.
// `step` is the 0-based current step; `step === STEPS.length` means everything is done. Orders that left the normal
// path (cancelled, declined by the publisher) have no position (`ended`).
export const PROGRESS_STEPS = ["Payment", "Your article", "Publisher", "Published", "Live and monitored"] as const;

export type Progress = { step: number; state: "on_track" | "attention" | "ended" };

const MAP: Record<OrderStatus, Progress> = {
  PAYMENT_PENDING: { step: 0, state: "on_track" },
  PAYMENT_UNDER_REVIEW: { step: 0, state: "on_track" },
  PAID: { step: 1, state: "on_track" },
  CONTENT_SUBMITTED: { step: 1, state: "on_track" },
  PENDING_PUBLISHER: { step: 2, state: "on_track" },
  ACCEPTED: { step: 2, state: "on_track" },
  IN_PROGRESS: { step: 2, state: "on_track" },
  PUBLISHED: { step: 3, state: "on_track" },
  VERIFICATION_PENDING: { step: 3, state: "on_track" },
  VERIFIED: { step: 4, state: "on_track" },
  MONITORING: { step: 4, state: "on_track" },
  ISSUE_DETECTED: { step: 4, state: "attention" },
  REPLACEMENT_REQUESTED: { step: 4, state: "attention" },
  DISPUTED: { step: 4, state: "attention" },
  COMPLETED: { step: PROGRESS_STEPS.length, state: "on_track" },
  CANCELLED: { step: -1, state: "ended" },
  PUBLISHER_REJECTED: { step: -1, state: "ended" }
};

export function orderProgress(status: OrderStatus): Progress {
  return MAP[status] ?? { step: -1, state: "ended" };
}
