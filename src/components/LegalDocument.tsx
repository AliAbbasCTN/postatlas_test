import Link from "next/link";
import { LEGAL } from "@/lib/legal";

export type LegalSection = { id: string; title: string; body: React.ReactNode };

// One readable layout for every legal page: title, effective date, a contents list that works as in-page links, then
// numbered sections. Server component; no scripts. Long lines are capped for readability and everything wraps on small screens.
export function LegalDocument({ title, intro, sections }: { title: string; intro: React.ReactNode; sections: LegalSection[] }) {
  return (
    <section className="py-10 md:py-14">
      <div className="mx-auto max-w-[760px] px-4 sm:px-6">
        <div className="mb-3 text-sm text-accenttext">Legal</div>
        <h1 className="mb-2 text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
        <p className="mb-6 text-sm text-inksoft">Effective {LEGAL.effectiveDate}</p>
        <div className="mb-8 text-inksoft">{intro}</div>
        <nav aria-label="Contents" className="card mb-10 !p-4">
          <h2 className="mb-2 text-sm font-semibold">Contents</h2>
          <ol className="grid gap-1 text-sm sm:grid-cols-2">
            {sections.map((s, i) => <li key={s.id}><a className="text-accenttext underline" href={`#${s.id}`}>{i + 1}. {s.title}</a></li>)}
          </ol>
        </nav>
        <div className="grid gap-8">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-24">
              <h2 id={`${s.id}-h`} className="mb-2 text-xl font-semibold">{i + 1}. {s.title}</h2>
              <div className="grid gap-3 text-[15px] leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:grid [&_ul]:gap-1.5 [&_a]:text-accenttext [&_a]:underline">{s.body}</div>
            </section>
          ))}
        </div>
        <p className="mt-12 border-t border-line pt-6 text-sm text-inksoft">Questions about this document? <Link className="text-accenttext underline" href={LEGAL.contactPath}>Contact us</Link>. See also our{" "}
          <Link className="text-accenttext underline" href="/terms">Terms of Service</Link>, <Link className="text-accenttext underline" href="/privacy">Privacy Policy</Link> and <Link className="text-accenttext underline" href="/refund-policy">Refund Policy</Link>.</p>
      </div>
    </section>
  );
}
