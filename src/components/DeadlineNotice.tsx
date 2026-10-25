import { OrderTimer } from "@/components/OrderTimer";
import { deadlineState, formatDueUtc, formatHours } from "@/lib/order-deadline";

// Where the delivery deadline stands, for either side. Server-rendered; the live HH:MM:SS timer is the only client island.
// `viewer` changes the wording, never the facts. A requested replacement uses the same clock as a first delivery.
export function DeadlineNotice({ status, dueAt, turnaroundHours, viewer }: { status: string; dueAt: string | null | undefined; turnaroundHours?: number | null; viewer: "customer" | "publisher" }) {
  const s = deadlineState({ status, due_at: dueAt });
  if (s.kind === "none") return null;
  const overdue = s.kind === "overdue";
  const replacement = status === "REPLACEMENT_REQUESTED";
  const windowText = turnaroundHours ? ` (${formatHours(turnaroundHours)} window)` : "";
  const title = overdue
    ? (viewer === "customer" ? (replacement ? "The publisher missed the replacement deadline" : "The publisher missed the delivery deadline") : "This order is past its delivery deadline")
    : replacement ? (viewer === "customer" ? "Replacement due" : "Deliver the replacement by") : (viewer === "customer" ? "Delivery deadline" : "Deliver by");
  return (
    <div role="status" className={`mb-6 rounded-lg border p-4 text-sm ${overdue ? "border-redsig/40 bg-[#FBE4E1] text-redsig" : "border-line bg-white"}`}>
      <div className="font-semibold">{title}</div>
      <div className={overdue ? "" : "text-inksoft"}><time dateTime={s.dueAt}>{formatDueUtc(s.dueAt)}</time>{windowText}</div>
      <OrderTimer dueAt={s.dueAt} serverNow={Date.now()} label={title} />
    </div>
  );
}
