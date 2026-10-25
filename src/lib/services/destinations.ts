import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";

// NOT a server action module: these functions are only called from admin server components, which have already run
// requireAdmin(). They are deliberately not exported from a "use server" file, so the browser cannot invoke them.

/** Full destination details for an administrator about to make a transfer. Every reveal is audited. */
export async function revealDestinationForAdmin(destinationId: string, adminId: string) {
  // Need-to-know: the full number is only ever disclosed while a transfer to this exact destination is actually waiting to
  // be made (PROCESSING) or reconciled (UNCERTAIN). Browsing a publisher's account details for any other reason is refused.
  const { count } = await createAdminClient().from("publisher_payouts").select("id", { count: "exact", head: true }).eq("destination_id", destinationId).in("status", ["PROCESSING", "UNCERTAIN"]);
  if (!count) return null;
  const { data: d } = await createAdminClient().from("payout_destinations").select("account_holder, bank_name, account_cipher, currency, swift_bic, status").eq("id", destinationId).maybeSingle();
  if (!d || d.status !== "VERIFIED") return null;
  await logAudit({ actorId: adminId, action: "payout_destination.revealed", resourceType: "payout_destination", resourceId: destinationId });
  return { holder: d.account_holder as string, bank: d.bank_name as string, account: decryptSecret(d.account_cipher), currency: d.currency as "USD" | "PKR", swift: (d.swift_bic as string | null) ?? null };
}
