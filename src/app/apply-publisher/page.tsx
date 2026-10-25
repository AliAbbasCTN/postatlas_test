import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyAsPublisher } from "@/lib/actions/publishers";
import { FormFeedback } from "@/components/FormFeedback";

export const metadata = { title: "Become a publisher", robots: { index: false, follow: false } };

export default async function ApplyPublisher({ searchParams }: { searchParams: Promise<{ error?: string; submitted?: string }> }) {
  const sp = await searchParams;
  const { user, platformRole } = await requireSession();
  const { data: existing } = await createAdminClient().from("publisher_profiles").select("approved").eq("user_id", user.id).maybeSingle();
  return (
    <div className="max-w-xl mx-auto p-6 md:p-10">
      <Link href="/dashboard" className="text-sm text-accenttext underline">Back to dashboard</Link>
      <h1 className="text-2xl font-semibold tracking-tight my-4">Become a publisher</h1>
      <FormFeedback error={sp.error} success={sp.submitted ? "Application received. Our team will review it." : undefined} />
      {platformRole === "publisher" ? <p>Your publisher account is active. <Link className="underline text-accenttext" href="/publisher">Open the publisher area</Link>.</p>
        : existing ? <p className="text-inksoft">Your application is {existing.approved ? "approved" : "waiting for review"}.</p> : (
        <form action={applyAsPublisher} className="card grid gap-4">
          <p className="text-sm text-inksoft">Publishers list websites they own and fulfil placement orders. Our team approves every publisher and every listing.</p>
          <div className="rounded-md bg-mist p-4 text-sm text-inksoft"><strong className="mb-1 block text-ink">What happens next</strong><ol className="grid list-decimal gap-1 pl-5"><li>You send this short application.</li><li>Our team reviews it. Until it is approved, you keep using your normal customer account.</li><li>After approval, add your websites. Each one is reviewed before customers can see it.</li></ol></div>
          <div><label className="label" htmlFor="display_name">Name or company</label><input id="display_name" name="display_name" required minLength={2} maxLength={100} className="input" /></div>
          <div><label className="label" htmlFor="bio">Tell us about your websites</label><textarea id="bio" name="bio" required minLength={20} maxLength={1000} rows={5} className="input" /></div>
          <button className="btn-primary w-fit">Apply</button>
        </form>)}
    </div>
  );
}
