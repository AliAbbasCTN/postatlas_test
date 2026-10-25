import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ title: "About PostAtlas", description: "Why PostAtlas exists: links that you can prove are real, and numbers that say where they came from.", path: "/about" });
export default function AboutPage() {
  return (
    <section className="py-14">
      <div className="max-w-[1180px] mx-auto px-6">
        <div className="text-sm text-accenttext mb-3">About</div>
        <h1 className="font-serif font-bold text-4xl mb-4 max-w-[32ch]">Built for people who have to prove a link is real</h1>
        <p className="text-inksoft max-w-[64ch] mb-10">PostAtlas started from a simple frustration: link building reports that show a spreadsheet of URLs, with no way to know which ones are still live six months later. We built a platform that keeps checking after the invoice is paid.</p>
        <div className="grid md:grid-cols-2 gap-10">
          <div>
            <h3 className="font-serif font-semibold text-xl mb-2">What we won&apos;t do</h3>
            <p className="text-inksoft">We won&apos;t promise guaranteed rankings or traffic. We won&apos;t show a DR score we haven&apos;t verified. We won&apos;t publish a Write for Us submission automatically.</p>
          </div>
          <div>
            <h3 className="font-serif font-semibold text-xl mb-2">What we will do</h3>
            <p className="text-inksoft">Show you exactly what&apos;s verified and what isn&apos;t, keep each organization&apos;s data private, and log every sensitive action for audit.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
