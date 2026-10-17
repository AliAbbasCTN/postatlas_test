"use client";

import { useEffect, useState } from "react";
import { deadlineState, formatDuration } from "@/lib/order-deadline";

// The countdown next to a deadline. The server renders the exact due date as plain text; this only adds "· 5 hours 12 minutes
// left" after the page loads and keeps it fresh, so nothing differs between server and browser markup (no hydration mismatch).
// It is a convenience: the deadline itself is decided by the database, never by this clock.
export function TimeLeft({ dueAt, status }: { dueAt: string; status: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (now == null) return null;
  const s = deadlineState({ status, due_at: dueAt }, now);
  if (s.kind === "running") return <span aria-live="off"> · {formatDuration(s.msLeft)} left</span>;
  if (s.kind === "overdue") return <span aria-live="off"> · {formatDuration(s.msLate)} overdue</span>;
  return null;
}
