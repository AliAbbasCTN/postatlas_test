import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { MobileNav } from "@/components/MobileNav";
import { HeaderAuth } from "@/components/HeaderAuth";

export const PUBLIC_NAV = [
  { href: "/check", label: "Check your website" },
  { href: "/publishers", label: "Publishers" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/blog", label: "Resources" },
  { href: "/pricing", label: "Pricing" },
  { href: "/contact", label: "Contact" }
];

export function SiteHeader() {
  return (
    <header className="border-b border-line sticky top-0 bg-paper z-50">
      <div className="max-w-[1180px] mx-auto flex items-center justify-between px-6 py-4 relative">
        <Link href="/" className="flex items-center gap-2 font-serif font-bold text-xl">
          <BrandMark size={28} />
          PostAtlas
        </Link>
        <nav aria-label="Main" className="hidden md:flex gap-7 text-sm text-inksoft">
          {PUBLIC_NAV.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
        </nav>
        <div className="hidden md:flex items-center gap-3"><HeaderAuth /></div>
        <MobileNav links={PUBLIC_NAV} />
      </div>
    </header>
  );
}
