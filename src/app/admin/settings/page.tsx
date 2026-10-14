import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPaymentMethod, togglePaymentMethod } from "@/lib/actions/payment-methods";
import { FormFeedback } from "@/components/FormFeedback";

export default async function AdminSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const sp = await searchParams;
  await requireSuperAdmin();
  const db = createAdminClient();
  const { data: methods } = await db.from("payment_methods").select("*").order("name");

  async function createAction(formData: FormData) {
    "use server";
    const result = await createPaymentMethod(formData);
    if (result?.error) redirect(`/admin/settings?error=${encodeURIComponent(result.error)}`);
    redirect("/admin/settings?done=1");
  }
  async function toggleAction(formData: FormData) {
    "use server";
    const result = await togglePaymentMethod(formData);
    if (result?.error) redirect(`/admin/settings?error=${encodeURIComponent(result.error)}`);
    redirect("/admin/settings?done=1");
  }

  return (
    <div>
      <h1 className="font-serif font-bold text-3xl mb-8">Platform settings</h1>
      <FormFeedback error={sp.error} success={sp.done ? "Saved." : undefined} />

      <h2 className="font-serif font-semibold text-xl mb-4">Payment methods</h2>
      <p className="text-inksoft mb-4 max-w-[60ch] text-sm">
        Customers see enabled methods when paying for an order. Nothing here is hard-coded in the frontend — this table is the single source of truth.
      </p>

      <form action={createAction} className="border border-line rounded-md p-6 mb-8 grid md:grid-cols-3 gap-4 items-end">
        <div><label className="block text-sm mb-1.5">Name</label><input name="name" required placeholder="Bank Transfer" className="w-full border border-line rounded px-3 py-2.5 text-sm" /></div>
        <div><label className="block text-sm mb-1.5">Account identifier</label><input name="account_identifier" required placeholder="IBAN / account number" className="w-full border border-line rounded px-3 py-2.5 text-sm" /></div>
        <button className="px-5 py-2.5 bg-ink text-paper rounded text-sm" type="submit">Add Method</button>
        <div className="md:col-span-3"><label className="block text-sm mb-1.5">Instructions shown to customers</label><textarea name="instructions" rows={2} className="w-full border border-line rounded px-3 py-2.5 text-sm" /></div>
      </form>

      {(!methods || methods.length === 0) ? (
        <div className="border border-dashed border-line rounded-md p-6 text-inksoft">No payment methods yet — add one above so customers can pay for orders.</div>
      ) : (
        <div className="border-t border-ink">
          {methods.map((m: any) => (
            <div key={m.id} className="flex justify-between items-center py-4 border-b border-line gap-4">
              <div className="flex-1">
                <div className="font-serif font-semibold">{m.name}</div>
                <div className="text-sm text-inksoft font-mono">{m.account_identifier}</div>
              </div>
              <form action={toggleAction}>
                <input type="hidden" name="method_id" value={m.id} />
                <input type="hidden" name="enabled" value={String(m.enabled)} />
                <button className={`px-3 py-1.5 border rounded text-sm ${m.enabled ? "border-verdigris text-verdigrisdark" : "border-line text-inksoft"}`} type="submit">
                  {m.enabled ? "Enabled" : "Disabled"}
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
