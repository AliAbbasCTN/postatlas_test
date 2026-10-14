import type { OrderStatus } from "./types.ts";

// Single source of truth for the order lifecycle. Every transition lists the
// actors allowed to trigger it. supabase/PostAtlas_fresh_supabase_schema.sql seeds the database's
// own copy of the (from, to) pairs and tests/order-state.test.ts fails if the
// two ever drift apart.
//
// Status meanings (customer-facing labels live in ORDER_STATUS_LABEL):
//   PAYMENT_PENDING      order created, waiting for the customer's payment details
//   PAYMENT_UNDER_REVIEW customer submitted a payment reference; admin reviewing
//   PAID                 payment approved; the customer must now submit the article
//   CONTENT_SUBMITTED    article submitted; held for admin review only if flagged
//   PENDING_PUBLISHER    waiting for the publisher to accept or reject
//   ACCEPTED / IN_PROGRESS  publisher committed / working
//   PUBLISHED            publisher submitted the live URL
//   VERIFICATION_PENDING PostAtlas is checking the live page (not yet verified)
//   VERIFIED             an actual check found the expected link
//   MONITORING           periodic checks active
//   ISSUE_DETECTED       repeated checks found a problem
export type Actor = "customer" | "publisher" | "admin" | "system";

type Rule = { from: OrderStatus; to: OrderStatus; actors: Actor[] };

const DISPUTABLE_FROM: OrderStatus[] = [
  "PAID", "CONTENT_SUBMITTED", "PENDING_PUBLISHER", "ACCEPTED", "IN_PROGRESS",
  "PUBLISHED", "VERIFICATION_PENDING", "VERIFIED", "MONITORING", "ISSUE_DETECTED"
];

export const TRANSITION_RULES: Rule[] = [
  { from: "PAYMENT_PENDING", to: "PAYMENT_UNDER_REVIEW", actors: ["customer"] },
  { from: "PAYMENT_PENDING", to: "CANCELLED", actors: ["customer", "admin"] },
  { from: "PAYMENT_UNDER_REVIEW", to: "PAID", actors: ["admin"] },
  // A rejected payment sends the order back so the customer can resubmit.
  { from: "PAYMENT_UNDER_REVIEW", to: "PAYMENT_PENDING", actors: ["admin"] },
  { from: "PAYMENT_UNDER_REVIEW", to: "CANCELLED", actors: ["admin"] },
  { from: "PAID", to: "CONTENT_SUBMITTED", actors: ["customer"] },
  { from: "PAID", to: "CANCELLED", actors: ["admin"] },
  // Article cleared the content policy scan, or an admin approved it.
  { from: "CONTENT_SUBMITTED", to: "PENDING_PUBLISHER", actors: ["system", "admin"] },
  // Admin asks the customer to revise the article.
  { from: "CONTENT_SUBMITTED", to: "PAID", actors: ["admin"] },
  { from: "CONTENT_SUBMITTED", to: "CANCELLED", actors: ["admin"] },
  { from: "PENDING_PUBLISHER", to: "ACCEPTED", actors: ["publisher"] },
  { from: "PENDING_PUBLISHER", to: "PUBLISHER_REJECTED", actors: ["publisher"] },
  { from: "PENDING_PUBLISHER", to: "CANCELLED", actors: ["admin"] },
  { from: "PUBLISHER_REJECTED", to: "CANCELLED", actors: ["admin"] },
  // Recovery: an admin gives a paid, declined order to another approved publisher (see reassign_order()).
  { from: "PUBLISHER_REJECTED", to: "PENDING_PUBLISHER", actors: ["admin"] },
  { from: "ACCEPTED", to: "IN_PROGRESS", actors: ["publisher"] },
  { from: "ACCEPTED", to: "PUBLISHED", actors: ["publisher"] },
  { from: "ACCEPTED", to: "CANCELLED", actors: ["admin"] },
  { from: "IN_PROGRESS", to: "PUBLISHED", actors: ["publisher"] },
  { from: "IN_PROGRESS", to: "CANCELLED", actors: ["admin"] },
  { from: "PUBLISHED", to: "VERIFICATION_PENDING", actors: ["system"] },
  { from: "VERIFICATION_PENDING", to: "VERIFIED", actors: ["system", "admin"] },
  { from: "VERIFICATION_PENDING", to: "PUBLISHED", actors: ["publisher"] }, // resubmit a corrected URL
  { from: "VERIFIED", to: "MONITORING", actors: ["system"] },
  { from: "MONITORING", to: "ISSUE_DETECTED", actors: ["system"] },
  { from: "MONITORING", to: "COMPLETED", actors: ["admin"] },
  { from: "ISSUE_DETECTED", to: "MONITORING", actors: ["system", "admin"] },
  { from: "ISSUE_DETECTED", to: "REPLACEMENT_REQUESTED", actors: ["customer", "admin"] },
  { from: "REPLACEMENT_REQUESTED", to: "IN_PROGRESS", actors: ["admin"] },
  { from: "REPLACEMENT_REQUESTED", to: "CANCELLED", actors: ["admin"] },
  { from: "REPLACEMENT_REQUESTED", to: "PENDING_PUBLISHER", actors: ["admin"] },
  ...DISPUTABLE_FROM.map((from): Rule => ({ from, to: "DISPUTED", actors: ["customer", "publisher", "admin"] })),
  // Only an admin resolves a dispute, and only into one of these states.
  ...(["MONITORING", "IN_PROGRESS", "REPLACEMENT_REQUESTED", "COMPLETED", "CANCELLED"] as OrderStatus[]).map(
    (to): Rule => ({ from: "DISPUTED", to, actors: ["admin"] })
  )
];

export const TERMINAL_STATUSES: OrderStatus[] = ["COMPLETED", "CANCELLED"];

export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor): boolean {
  return TRANSITION_RULES.some((r) => r.from === from && r.to === to && r.actors.includes(actor));
}

export function allowedTransitions(from: OrderStatus, actor: Actor): OrderStatus[] {
  return TRANSITION_RULES.filter((r) => r.from === from && r.actors.includes(actor)).map((r) => r.to);
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PAYMENT_PENDING: "Waiting for your payment",
  PAYMENT_UNDER_REVIEW: "Payment under review",
  PAID: "Payment approved - article needed",
  CONTENT_SUBMITTED: "Article under review",
  PENDING_PUBLISHER: "Waiting for the publisher",
  ACCEPTED: "Publisher accepted",
  IN_PROGRESS: "Publisher is working on it",
  PUBLISHED: "Published - checking the link",
  VERIFICATION_PENDING: "Checking the link",
  VERIFIED: "Link verified",
  MONITORING: "Monitoring active",
  ISSUE_DETECTED: "Issue detected",
  REPLACEMENT_REQUESTED: "Replacement requested",
  COMPLETED: "Completed",
  PUBLISHER_REJECTED: "Publisher declined",
  CANCELLED: "Cancelled",
  DISPUTED: "Under dispute"
};

// What should the customer do next? Drives the one primary button on an order.
export function customerNextAction(status: OrderStatus): { label: string; hint: string } | null {
  switch (status) {
    case "PAYMENT_PENDING": return { label: "Submit payment details", hint: "Pay using the instructions below, then enter your reference." };
    case "PAID": return { label: "Submit your article", hint: "Your payment is approved. The publisher needs your article." };
    case "ISSUE_DETECTED": return { label: "Review the issue", hint: "A recent check found a problem with this placement." };
    case "PAYMENT_UNDER_REVIEW":
    case "CONTENT_SUBMITTED":
    case "PENDING_PUBLISHER":
    case "ACCEPTED":
    case "IN_PROGRESS":
    case "PUBLISHED":
    case "VERIFICATION_PENDING":
      return { label: "View order status", hint: "Nothing is needed from you right now." };
    case "VERIFIED":
    case "MONITORING":
      return { label: "View placement health", hint: "Monitoring is active." };
    default: return null;
  }
}
