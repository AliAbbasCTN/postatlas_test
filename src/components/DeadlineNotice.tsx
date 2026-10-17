import { TimeLeft } from "@/components/TimeLeft";
import { deadlineState, formatDueUtc, formatHours } from "@/lib/order-deadline";

// One line (and a status colour) that tells either side where the delivery deadline stands. Server-rendered; only the
// "time left" suffix is a client island. `viewer` changes the wording, not the facts.
export function DeadlineNotice({ status, dueAt, turnaroundHours, viewer }: { status: string; dueAt: string | null | undefined; turnaroundHours?: number | null; viewer: "customer" | "publisher" }) {
  const s = deadlineState({ status, due_at: dueAt });
  if (s.kind === "none") return null;
  const overdue = s.kind === "overdue";
  const windowText = turnaroundHours ? ` (${formatHours(turnaroundHours)} from acceptance)` : "";
  return (
    <div role="status" className={`mb-6 rounded-lg border p-4 text-sm ${overdue ? "border-redsig/40 bg-[#FBE4E1] text-redsig" : "border-line bg-white"}`}>
      <div className="font-semibold">{overdue ? (viewer === "customer" ? "The publisher missed the delivery deadline" : "This order is past its delivery deadline") : (viewer === "customer" ? "Delivery deadline" : "Deliver by")}</div>
      <div className={overdue ? "" : "text-inksoft"}>
        <time dateTime={s.dueAt}>{formatDueUtc(s.dueAt)}</time>{windowText}<TimeLeft dueAt={s.dueAt} status={status} />
      </div>
    </div>
  );
}
