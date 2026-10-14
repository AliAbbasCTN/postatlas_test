import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { signOut } from "@/lib/actions/auth";

export type NavItem = { href: string; label: string };

// Sidebar on md+, a scrollable top bar on small screens (so mobile users are never without navigation).
export function AppShell({ area, orgName, nav, extra, dark, children }: { area: string; orgName?: string; nav: NavItem[]; extra?: NavItem[]; dark?: boolean; children: React.ReactNode }) {
  const link = dark ? "hover:bg-white/10" : "hover:bg-paperdim";
  return (
    <div className="min-h-screen md:flex">
      <a href="#main" className="sr-only-focusable absolute left-2 top-2 z-50 bg-white border border-ink px-3 py-1.5 rounded text-sm">Skip to content</a>
      <aside className={`hidden md:flex md:flex-col w-60 shrink-0 border-r border-line p-6 ${dark ? "bg-ink text-paperdim" : "bg-paper"}`}>
        <Link href="/" className={`flex items-center gap-2 font-serif font-bold text-lg mb-1 ${dark ? "text-white" : ""}`}>
          <BrandMark size={26} onDark={dark} /> PostAtlas
        </Link>
        <div className={`text-xs mb-8 ${dark ? "text-[#9AA6B2]" : "text-inksoft"}`}>{orgName ?? area}</div>
        <nav aria-label={`${area} navigation`} className="flex flex-col gap-1 text-sm">
          {nav.map((n) => <Link key={n.href} href={n.href} className={`px-3 py-2 rounded ${link}`}>{n.label}</Link>)}
        </nav>
        {extra && (
          <nav aria-label="More" className="flex flex-col gap-1 text-sm mt-6 pt-6 border-t border-line/40">
            {extra.map((n) => <Link key={n.href} href={n.href} className={`px-3 py-2 rounded ${link}`}>{n.label}</Link>)}
          </nav>
        )}
        <form action={signOut} className="mt-auto pt-10">
          <button className={`text-sm ${dark ? "text-[#9AA6B2] hover:text-white" : "text-inksoft hover:text-ink"}`}>Log out</button>
        </form>
      </aside>

      <div className="md:hidden border-b border-line bg-paper sticky top-0 z-40">
        <div className="flex items-center justify-between px-4 pt-3">
          <Link href="/" className="flex items-center gap-2 font-serif font-bold"><BrandMark size={22} /> PostAtlas</Link>
          <form action={signOut}><button className="text-sm text-inksoft">Log out</button></form>
        </div>
        <nav aria-label={`${area} navigation`} className="flex gap-1 overflow-x-auto px-3 py-2 text-sm whitespace-nowrap">
          {[...nav, ...(extra ?? [])].map((n) => <Link key={n.href} href={n.href} className="px-3 py-1.5 rounded hover:bg-paperdim">{n.label}</Link>)}
        </nav>
      </div>

      <main id="main" className="flex-1 min-w-0 p-5 md:p-8 max-w-[1100px] w-full">{children}</main>
    </div>
  );
}
