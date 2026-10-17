import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { moderateReview } from "@/lib/actions/reviews";
import { PageHeader, EmptyState, fmtDateTime } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { StarsDisplay } from "@/components/Stars";
import Link from "next/link";

export const metadata = { title: "Moderate reviews" };

export default async function AdminReviews({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const sp = await searchParams;
  await requireAdmin();
  const { data } = await createAdminClient().from("site_reviews")
    .select("id, order_id, rating, comment, status, hidden_reason, created_at, publisher_websites(domain)").order("created_at", { ascending: false }).limit(100);
  const rows: any[] = data ?? [];
  return (
    <div>
      <PageHeader title="Moderate reviews" subtitle="Customer reviews of listed websites. Hide a review that breaks the rules (abuse, personal data, off-topic). The text is never edited, and a hidden review can be restored." />
      <FormFeedback error={sp.error} success={sp.done ? "Saved." : undefined} />
      {rows.length === 0 ? <EmptyState title="No reviews yet" /> : (
        <ul className="grid gap-4">{rows.map((r) => { const w = Array.isArray(r.publisher_websites) ? r.publisher_websites[0] : r.publisher_websites; return (
          <li key={r.id} className="card text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><b>{w?.domain}</b> · <Link className="underline" href={`/admin/orders/${r.order_id}`}>order</Link><div className="text-xs text-inksoft">{fmtDateTime(r.created_at)}</div></div>
              <span className={`status-pill ${r.status === "hidden" ? "status-removed" : "status-verified"}`}>{r.status === "hidden" ? "Hidden" : "Published"}</span>
            </div>
            <div className="mt-2"><StarsDisplay rating={r.rating} showText={false} /> <span className="text-inksoft">{r.rating} out of 5</span></div>
            {r.comment && <p className="mt-2 whitespace-pre-line">{r.comment}</p>}
            {r.status === "hidden" && r.hidden_reason && <p className="mt-2 text-xs text-inksoft">Hidden because: {r.hidden_reason}</p>}
            <form action={moderateReview} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <input type="hidden" name="review_id" value={r.id} />
              {r.status === "published" ? (<>
                <div className="min-w-[220px] flex-1"><label className="label" htmlFor={`r${r.id}`}>Reason for hiding</label><input id={`r${r.id}`} name="reason" required minLength={5} maxLength={500} className="input" /></div>
                <button name="decision" value="hide" className="btn-danger">Hide review</button>
              </>) : <button name="decision" value="restore" className="btn">Restore review</button>}
            </form>
          </li>); })}</ul>)}
    </div>
  );
}
