"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionPublisher } from "@/lib/auth";
import { withRedirect, ActionError } from "@/lib/action-utils";
import { logAudit } from "@/lib/audit";
import { text, oneOf } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { notifyMany, notifyStaff } from "@/lib/services/notify";
import { encryptSecret, last4, payoutEncryptionConfigured, validateAccountNumber } from "@/lib/crypto";

// A publisher saves where they want to be paid. Details are encrypted before storage, the browser never gets them back,
// and a destination is unusable until an administrator verifies it. Only the caller's OWN publisher profile is touched
// (the profile id comes from the session, never from the form).
export async function saveDestination(formData: FormData) {
  return withRedirect("/publisher/payouts", async () => {
    const { user } = await actionPublisher();
    await rateLimit(`destination:${user.id}`, 3600, 10);
    if (!payoutEncryptionConfigured()) throw new ActionError("Payout details cannot be saved yet: the platform is missing its encryption key. Please contact support.");
    const currency = oneOf(formData, "currency", "Currency", ["USD", "PKR"] as const);
    const country = text(formData, "country", "Country", { min: 2, max: 60 });
    const holder = text(formData, "account_holder", "Account holder name", { min: 2, max: 120 });
    const bank = text(formData, "bank_name", "Bank name", { min: 2, max: 120 });
    const swift = text(formData, "swift_bic", "SWIFT/BIC", { max: 11, optional: true });
    if (swift && !/^[A-Za-z0-9]{8,11}$/.test(swift)) throw new ActionError("SWIFT/BIC must be 8 or 11 letters and digits.");
    if (currency === "USD" && !swift) throw new ActionError("A USD account needs a SWIFT/BIC code.");
    let account: string;
    try { account = validateAccountNumber(text(formData, "account_number", "Account number or IBAN", { min: 6, max: 40 }), currency); }
    catch (e) { throw new ActionError(e instanceof Error ? e.message : "Invalid account number"); }

    const db = createAdminClient();
    const { data: profile } = await db.from("publisher_profiles").select("id").eq("user_id", user.id).maybeSingle();
    if (!profile) throw new ActionError("Publisher profile not found.");
    // One atomic database call: the previous destination for this currency is disabled and the new (unverified) one inserted
    // together, so a failure can never leave the publisher with neither. The old one is disabled, never edited or deleted.
    const { data: id, error } = await db.rpc("replace_payout_destination", {
      p_publisher: profile.id, p_currency: currency, p_country: country, p_holder: holder, p_bank: bank, p_swift: swift || null,
      p_cipher: encryptSecret(account), p_last4: last4(account)
    });
    if (error || typeof id !== "string") { console.error("[saveDestination]", error?.code ?? "no id"); throw new ActionError("Could not save your payout details."); }   // never log the message: it may echo values
    const row = { id };
    await logAudit({ actorId: user.id, action: "payout_destination.saved", resourceType: "payout_destination", resourceId: row.id });   // no account data in the log
    await notifyStaff("A publisher added payout details", "A publisher submitted payout details for verification.", "/admin/payouts");
    // Tell the account owner too: if someone else changed these details, this is how the real owner finds out.
    await notifyMany([user.id], "payout_destination.saved", { destination_id: row.id }, { subject: "Your payout details were changed", body: "New payout details were saved on your PostAtlas account and are waiting for verification. If this was not you, contact support and change your password now.", path: "/publisher/payouts" }).catch(() => undefined);
    revalidatePath("/publisher/payouts");
    redirect(`/publisher/payouts?notice=${encodeURIComponent("Saved. We will verify your details before any payout is sent.")}`);
  });
}
