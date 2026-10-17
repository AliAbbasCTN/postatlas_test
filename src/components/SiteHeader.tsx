import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { MobileNav } from "@/components/MobileNav";
import { HeaderAuth } from "@/components/HeaderAuth";

// Every link points at an existing public route (a test checks this). "Explore Sites" is the publisher marketplace.
export const PUBLIC_NAV = [
  { href: "/publishers", label: "Explore Sites" },
  { href: "/check", label: "Check Your Website" },
  { href: "/for-publishers", label: "For Publishers" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/blog", label: "Resources" }
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="relative mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-lg font-semibold">
          <BrandMark size={28} />
          PostAtlas
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 text-sm lg:flex">
          {PUBLIC_NAV.map((l) => <Link key={l.href} href={l.href} className="rounded-md px-3 py-2 text-inksoft transition-colors hover:bg-mist hover:text-ink">{l.label}</Link>)}
        </nav>
        <div className="hidden items-center gap-2 lg:flex"><HeaderAuth /></div>
        <MobileNav links={PUBLIC_NAV} />
      </div>
    </header>
  );
}
