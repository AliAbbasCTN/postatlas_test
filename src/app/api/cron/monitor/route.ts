import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runDueChecks } from "@/lib/services/placements";
import { notifyStaff } from "@/lib/services/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24) return false; // refuse to run with a missing/weak secret
  const header = request.headers.get("authorization") ?? "";
  const enc = new TextEncoder();
  const given = enc.encode(header.startsWith("Bearer ") ? header.slice(7) : "");
  const want = enc.encode(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

// Called on a schedule (see vercel.json) with "Authorization: Bearer $CRON_SECRET".
export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { checked } = await runDueChecks(25);
    return NextResponse.json({ ok: true, checked });
  } catch (e) {
    console.error("[cron/monitor]", e instanceof Error ? e.message : "unknown");
    await notifyStaff("The backlink monitoring job failed", "The scheduled monitoring run failed. Placements may not be checked until it recovers.", "/admin/orders").catch(() => undefined);
    return NextResponse.json({ error: "Monitoring run failed" }, { status: 500 });
  }
}
