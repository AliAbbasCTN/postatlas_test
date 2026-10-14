import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyMany, notifyStaff } from "@/lib/services/notify";
import { logAudit } from "@/lib/audit";

type Db = ReturnType<typeof createAdminClient>;

async function publisherUser(db: Db, publisherId: string): Promise<string | null> {
  const { data } = await db.from("publisher_profiles").select("user_id").eq("id", publisherId).maybeSingle();
  return data?.user_id ?? null;
}

// Called right after a placement is verified (automatic check or admin manual verification). It must never undo or
// fail the verification itself: a problem is logged and staff are alerted, and reconcileMissingObligations() in the
// finance cron creates anything that was missed. The database function is idempotent.
export async function onPlacementVerified(orderId: string, verifiedAtIso: string): Promise<void> {
  const db = createAdminClient();
  try {
    const { data: id, error } = await db.rpc("create_payout_obligation", { p_order: orderId, p_verified_at: verifiedAtIso });
    if (error) throw new Error(error.message);
    const { data: p } = await db.from("publisher_payouts").select("id, publisher_id, status, amount, created_at").eq("id", id as string).maybeSingle();
    if (p && Date.now() - Date.parse(p.created_at) < 60_000) {          // only announce a newly created obligation
      const uid = await publisherUser(db, p.publisher_id);
      if (uid) await notifyMany([uid], p.status === "HELD" ? "payout.held" : "payout.eligible", { order_id: orderId, payout_id: p.id },
        { subject: p.status === "HELD" ? "A payout is on hold" : "A payout is now eligible", body: p.status === "HELD" ? "A dispute is open on this order, so the payout is on hold until it is resolved." : "Your placement was verified. We aim to start processing your payout within 12 hours; bank settlement time depends on your bank.", path: "/publisher/payouts" });
    }
    await logAudit({ actorId: null, action: "payout.obligation_created", resourceType: "order", resourceId: orderId });
  } catch (e) {
    console.error("[payouts] obligation failed", orderId, e instanceof Error ? e.message : "unknown");
    await notifyStaff("Payout obligation could not be created", `Order ${orderId} was verified but its payout obligation could not be recorded. The finance job will retry.`, `/admin/orders/${orderId}`).catch(() => undefined);
  }
}

export type FinanceRunSummary = { fxOk: boolean; obligationsCreated: number; started: number; overdueAlerts: number; escalated: number; missedChecks: number };

export async function runFinanceJobs(): Promise<FinanceRunSummary> {
  const db = createAdminClient();
  const summary: FinanceRunSummary = { fxOk: true, obligationsCreated: 0, started: 0, overdueAlerts: 0, escalated: 0, missedChecks: 0 };

  // 1. exchange rate (refreshes only when the stored one is older than 12 hours)
  try { const { getUsdPkr } = await import("@/lib/services/fx"); summary.fxOk = (await getUsdPkr({ refresh: true })) !== null; } catch { summary.fxOk = false; }

  // 2. verified placements that somehow have no payout obligation yet
  const { data: missing } = await db.rpc("orders_missing_payout_obligation", { p_limit: 100 });
  for (const m of (missing ?? []) as { order_id: string; verified_at: string }[]) { await onPlacementVerified(m.order_id, m.verified_at); summary.obligationsCreated++; }

  // 2b. paid orders a publisher declined that somehow have no recovery case (so they can never sit stranded)
  const { data: rejected } = await db.from("orders").select("id").eq("status", "PUBLISHER_REJECTED").limit(50);
  for (const o of rejected ?? []) {
    const { data: open } = await db.from("recovery_cases").select("id").eq("order_id", o.id).in("status", ["OPEN", "ESCALATED", "REASSIGNED"]).maybeSingle();
    if (open) continue;
    try { const { openRejectionCase } = await import("@/lib/services/recovery"); await openRejectionCase(o.id, "Publisher declined the order", null); } catch { /* retried next run */ }
  }

  // 3. start processing of eligible payouts (idempotent, skip-locked). 'Started' means queued for the transfer workflow.
  const { data: started, error } = await db.rpc("start_due_payouts", { p_limit: 100 });
  if (error) console.error("[finance] start_due_payouts", error.message);
  for (const p of (started ?? []) as { id: string; publisher_id: string; order_id: string }[]) {
    summary.started++;
    const uid = await publisherUser(db, p.publisher_id);
    if (uid) await notifyMany([uid], "payout.processing", { payout_id: p.id }, { subject: "Your payout is being processed", body: "We have started processing your payout. Settlement time depends on your bank.", path: "/publisher/payouts" });
  }
  if (started && (started as unknown[]).length > 0) await notifyStaff("Payouts are waiting for transfer", `${(started as unknown[]).length} payout(s) entered the transfer queue.`, "/admin/payouts");

  // 4. past the 12-hour processing target and still not started (usually: no verified payout destination). Alert once each.
  const { data: overdue } = await db.from("publisher_payouts").select("id, publisher_id, last_error").eq("status", "ELIGIBLE").is("overdue_alerted_at", null).lt("process_by", new Date().toISOString()).limit(50);
  for (const p of overdue ?? []) {
    await db.from("publisher_payouts").update({ overdue_alerted_at: new Date().toISOString() }).eq("id", p.id).is("overdue_alerted_at", null);
    summary.overdueAlerts++;
    const uid = await publisherUser(db, p.publisher_id);
    if (uid) await notifyMany([uid], "payout.action_needed", { payout_id: p.id }, { subject: "Action needed to receive your payout", body: "Your payout could not start yet. Please add and verify your payout details.", path: "/publisher/payouts" });
    await notifyStaff("Payout past its 12-hour processing target", `Payout ${p.id} has not started: ${p.last_error ?? "reason not recorded"}.`, "/admin/payouts");
  }

  // 5. recovery cases past their deadline are escalated to an admin (once: the status change is the guard)
  const { data: late } = await db.from("recovery_cases").select("id, order_id, kind").eq("status", "OPEN").lt("deadline_at", new Date().toISOString()).limit(50);
  for (const c of late ?? []) {
    const { data: ok } = await db.rpc("escalate_recovery_case", { p_case: c.id, p_actor: null, p_reason: "Deadline passed without resolution" });
    if (ok) { summary.escalated++; await notifyStaff("Recovery case escalated", `A ${c.kind === "link_restoration" ? "link restoration" : "publisher rejection"} case passed its deadline.`, "/admin/recovery"); }
  }

  // 6. monitoring health: placements overdue for a check by 3+ hours
  const { count } = await db.from("published_placements").select("id", { count: "exact", head: true }).in("health", ["HEALTHY", "ISSUE", "NEEDS_REVIEW"]).lt("next_check_at", new Date(Date.now() - 3 * 3600_000).toISOString());
  summary.missedChecks = count ?? 0;
  if (summary.missedChecks > 0) {
    const { rateLimit } = await import("@/lib/rate-limit");
    try { await rateLimit("alert:missed-checks", 6 * 3600, 1); await notifyStaff("Backlink checks are running late", `${summary.missedChecks} placement(s) are more than 3 hours overdue for a check. Verify the monitoring cron job.`, "/admin/orders"); } catch { /* already alerted recently */ }
  }
  return summary;
}
