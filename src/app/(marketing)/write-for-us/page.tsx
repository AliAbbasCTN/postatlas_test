import { submitWriteForUs } from "@/lib/actions/write-for-us";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Write for Us | Submit a Guest Post to PostAtlas",
  description: "Write for PostAtlas and share original, practical insights about SEO, digital marketing, link building, technology, SaaS, content marketing and online business.",
  alternates: { canonical: "/write-for-us" },
  robots: "index, follow"
};

export default async function WriteForUsPage({ searchParams }: { searchParams: Promise<{ submitted?: string; error?: string }> }) {
  const sp = await searchParams;
  async function action(formData: FormData) {
    "use server";
    const result = await submitWriteForUs(formData);
    if (result.error) redirect(`/write-for-us?error=${encodeURIComponent(result.error)}#submit`);
    redirect("/write-for-us?submitted=1#submit");
  }

  return (
    <>
      <section className="py-14 border-b border-line">
        <div className="max-w-[1180px] mx-auto px-6">
          <div className="text-sm text-verdigrisdark mb-3">Write for Us</div>
          <h1 className="font-serif font-bold text-4xl mb-4">Write for PostAtlas</h1>
          <p className="text-inksoft max-w-[60ch] mb-6">Share original, practical insights with readers interested in SEO, digital marketing, technology, SaaS, content strategy, link building and online business.</p>
          <a href="#submit" className="inline-block px-5 py-3 bg-ink text-paper rounded text-sm">Submit Your Article</a>
        </div>
      </section>

      <section className="py-14 bg-paperdim border-b border-line">
        <div className="max-w-[1180px] mx-auto px-6 grid md:grid-cols-2 gap-10">
          <div className="border-l-2 border-verdigris pl-5">
            <h3 className="font-serif font-semibold text-xl mb-3">Article requirements</h3>
            <ul className="list-disc pl-5 text-inksoft space-y-2">
              <li>At least 1,000 words; 1,200–2,000 recommended</li>
              <li>Original, human-reviewed, and genuinely useful</li>
              <li>Clear structure with meaningful headings</li>
            </ul>
          </div>
          <div className="border-l-2 border-redsig pl-5">
            <h3 className="font-serif font-semibold text-xl mb-3">Content we do not accept</h3>
            <ul className="list-disc pl-5 text-inksoft space-y-2">
              <li>Casino, gambling or sports betting content</li>
              <li>CBD, cannabis, vape or nicotine promotion</li>
              <li>PBN placements or manipulative link schemes</li>
              <li>Adult, fraudulent, or deceptive content</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="submit" className="py-14">
        <div className="max-w-[1180px] mx-auto px-6">
          <h2 className="font-serif font-bold text-3xl mb-6">Submit your article</h2>

          {sp.submitted && (
            <div className="mb-6 border border-verdigris rounded-md p-5 bg-[#E4EEEA]">
              <strong className="block font-serif mb-1">Submission received</strong>
              Thank you for submitting your article to PostAtlas. Our editorial team will review your submission against our content and editorial guidelines. Submission does not guarantee publication.
            </div>
          )}
          {sp.error && (
            <div className="mb-6 border border-redsig rounded-md p-5 bg-[#F4E1DC] text-redsig">{sp.error}</div>
          )}

          <form action={action} className="border border-line rounded-md p-8 max-w-[760px]">
            <div className="grid md:grid-cols-2 gap-5 mb-5">
              <div><label className="block text-sm mb-1.5">Full name</label><input name="name" required className="w-full border border-line rounded px-3 py-2.5 text-sm" /></div>
              <div><label className="block text-sm mb-1.5">Email</label><input type="email" name="email" required className="w-full border border-line rounded px-3 py-2.5 text-sm" /></div>
            </div>
            <div className="mb-5"><label className="block text-sm mb-1.5">Article title</label><input name="article_title" required className="w-full border border-line rounded px-3 py-2.5 text-sm" /></div>
            <div className="mb-5">
              <label className="block text-sm mb-1.5">Full article (minimum 1,000 words)</label>
              <textarea name="article" required rows={10} className="w-full border border-line rounded px-3 py-2.5 text-sm" />
            </div>
            <div className="mb-5"><label className="block text-sm mb-1.5">Author bio</label><textarea name="bio" rows={3} className="w-full border border-line rounded px-3 py-2.5 text-sm" /></div>
            <input type="text" name="company_website_hp" tabIndex={-1} autoComplete="off" className="absolute -left-[9999px]" />
            <button type="submit" className="px-5 py-2.5 bg-ink text-paper rounded text-sm">Submit Your Article</button>
          </form>
        </div>
      </section>
    </>
  );
}
