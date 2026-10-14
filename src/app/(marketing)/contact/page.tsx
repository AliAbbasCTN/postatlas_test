import { redirect } from "next/navigation";
import { submitContact } from "@/lib/actions/contact";
import { FormFeedback } from "@/components/FormFeedback";

import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ title: "Contact PostAtlas", description: "Questions about an order, a publisher application or the platform? Send us a message and we will reply by email.", path: "/contact" });

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const sp = await searchParams;
  async function action(formData: FormData) {
    "use server";
    const result = await submitContact(formData);
    if (result?.error) redirect(`/contact?error=${encodeURIComponent(result.error)}`);
    redirect("/contact?sent=1");
  }

  return (
    <section className="py-14">
      <div className="max-w-[1180px] mx-auto px-6 grid md:grid-cols-2 gap-12">
        <div>
          <div className="text-sm text-verdigrisdark mb-3">Contact</div>
          <h1 className="font-serif font-bold text-4xl mb-4">Talk to PostAtlas</h1>
          <p className="text-inksoft max-w-[52ch] mb-8">Questions about an order, a publisher application, or the platform in general — send a message and we&apos;ll follow up by email.</p>
          <p className="text-sm text-inksoft">Already a customer? The fastest way to get an answer is <a className="underline text-verdigrisdark" href="/dashboard/advice/new">Ask for advice</a> inside your account.</p>
        </div>
        <form action={action} className="border border-line rounded-md p-8">
          <FormFeedback error={sp.error} success={sp.sent ? "Message sent — we'll follow up by email." : undefined} />
          <div className="mb-5"><label htmlFor="name" className="block text-sm mb-1.5">Full name</label><input id="name" name="name" required maxLength={100} className="w-full border border-line rounded px-3 py-2.5 text-sm" /></div>
          <div className="mb-5"><label htmlFor="email" className="block text-sm mb-1.5">Email</label><input id="email" type="email" name="email" required maxLength={254} className="w-full border border-line rounded px-3 py-2.5 text-sm" /></div>
          <div className="mb-5"><label htmlFor="subject" className="block text-sm mb-1.5">Subject</label><input id="subject" name="subject" required maxLength={150} className="w-full border border-line rounded px-3 py-2.5 text-sm" /></div>
          <div className="mb-5"><label htmlFor="message" className="block text-sm mb-1.5">Message</label><textarea id="message" name="message" required minLength={10} maxLength={5000} rows={5} className="w-full border border-line rounded px-3 py-2.5 text-sm" /></div>
          <input type="text" name="company_website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px]" />
          <button type="submit" className="px-5 py-2.5 bg-ink text-paper rounded text-sm">Send Message</button>
        </form>
      </div>
    </section>
  );
}
