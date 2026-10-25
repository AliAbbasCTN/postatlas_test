import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runFinanceJobs } from "@/lib/services/payouts";
import { notifyStaff } from "@/lib/services/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24) return false;
  const header = request.headers.get("authorization") ?? "";
  const enc = new TextEncoder();
  const given = enc.encode(header.startsWith("Bearer ") ? header.slice(7) : "");
  const want = enc.encode(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

// Scheduled (vercel.json) with "Authorization: Bearer $CRON_SECRET". Safe to run repeatedly and concurrently.
export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runFinanceJobs()) });
  } catch (e) {
    console.error("[cron/finance]", e instanceof Error ? e.message : "unknown");
    await notifyStaff("The finance job failed", "The scheduled finance job (payout queue, exchange rate, recovery deadlines) failed. Check the server logs.", "/admin").catch(() => undefined);
    return NextResponse.json({ error: "Finance run failed" }, { status: 500 });
  }
}
