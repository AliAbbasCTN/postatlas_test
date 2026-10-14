import { ORDER_STATUS_LABEL } from "@/lib/order-state";
import type { OrderStatus } from "@/lib/types";

const GOOD = ["VERIFIED", "MONITORING", "HEALTHY", "COMPLETED", "PAID", "approved", "RESOLVED", "OPEN_OK", "ACCEPTED", "admin_verified"];
const WARN = ["PAYMENT_UNDER_REVIEW", "PAYMENT_PENDING", "CONTENT_SUBMITTED", "PENDING_PUBLISHER", "VERIFICATION_PENDING", "REPLACEMENT_REQUESTED", "pending_review", "PENDING", "UNDER_REVIEW", "NEEDS_REVIEW", "LINK_CHANGED", "IN_PROGRESS", "PUBLISHED", "HELD", "REQUIRES_REVIEW"];
const BAD = ["ISSUE_DETECTED", "ISSUE", "DISPUTED", "PUBLISHER_REJECTED", "CANCELLED", "rejected", "suspended", "REJECTED", "FAILED", "LINK_MISSING", "PAGE_UNAVAILABLE", "PAYMENT_REJECTED", "OPEN"];

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const cls = GOOD.includes(status) ? "status-verified" : BAD.includes(status) ? "status-removed" : WARN.includes(status) ? "status-changed" : "status-review";
  const text = label ?? ORDER_STATUS_LABEL[status as OrderStatus] ?? status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
  return <span className={`inline-block px-2.5 py-1 rounded text-xs font-medium ${cls}`}>{text}</span>;
}
