"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { splitDuration, pad2 } from "@/lib/order-deadline";

// Live delivery countdown (HH : MM : SS), like a marketplace order timer.
//
// Accuracy rules:
//  * The deadline is an ABSOLUTE timestamp (`dueAt`, set by the database when the publisher accepted). Every tick recomputes
//    "due - now" from scratch, so a page refresh, a sleeping laptop or a throttled background tab can never make it drift.
//  * The server also sends ITS clock (`serverNow`). The browser's clock error is measured once and removed, so a wrong device
//    clock cannot show the wrong time. The first render uses serverNow only, so server and browser markup are identical.
//  * The instant the timer crosses zero the page refreshes itself once, so the server-rendered "refund or alternative" options
//    appear without a manual reload. The deadline itself is always decided by the database, never by this clock.
export function OrderTimer({ dueAt, serverNow, label }: { dueAt: string; serverNow: number; label: string }) {
  const due = Date.parse(dueAt);
  const [remaining, setRemaining] = useState(due - serverNow);
  const router = useRouter();
  const crossed = useRef(due - serverNow <= 0);
  useEffect(() => {
    const skew = serverNow - Date.now();
    const tick = () => {
      const left = due - (Date.now() + skew);
      setRemaining(left);
      if (left <= 0 && !crossed.current) { crossed.current = true; router.refresh(); }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [due, serverNow, router]);

  const { late, hours, minutes, seconds } = splitDuration(remaining);
  const unit = "flex min-w-[3.5rem] flex-col items-center rounded-md border px-2 py-1.5";
  const tone = late ? "border-redsig/40 bg-white text-redsig" : "border-line bg-white text-ink";
  return (
    <div role="timer" aria-label={`${label}: ${hours} hours ${minutes} minutes ${seconds} seconds ${late ? "overdue" : "left"}`} className="mt-3">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide">{late ? "Overdue by" : "Time left"}</div>
      <div className="flex items-center gap-2 font-mono tabular-nums" aria-hidden>
        {[[hours, "hours"], [minutes, "min"], [seconds, "sec"]].map(([v, l], i) => (
          <div key={l as string} className="flex items-center gap-2">
            {i > 0 && <span className="text-xl font-semibold">:</span>}
            <div className={`${unit} ${tone}`}><span className="text-2xl font-semibold leading-none">{pad2(v as number)}</span><span className="mt-1 font-sans text-[10px] uppercase text-inksoft">{l as string}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}
