import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { NavLinks, type NavItem } from "@/components/NavLinks";
import { MobileAppMenu } from "@/components/MobileAppMenu";
import { signOut } from "@/lib/actions/auth";

export type { NavItem };

const WORKSPACE_LABEL: Record<string, string> = { Account: "Customer workspace", Publisher: "Publisher workspace", Admin: "Admin workspace" };

// Persistent sidebar on md+ and a compact top bar with a menu on small screens, so navigation is always available.
// The workspace label states clearly which area the person is in. Showing a link here is never an access check:
// every area enforces its own server-side guard in its layout.
export function AppShell({ area, orgName, nav, extra, dark, children }: { area: string; orgName?: string; nav: NavItem[]; extra?: NavItem[]; dark?: boolean; children: React.ReactNode }) {
  const workspace = WORKSPACE_LABEL[area] ?? area;
  const muted = dark ? "text-[#AEB9C6]" : "text-inksoft";
  return (
    <div className="min-h-screen md:flex">
      <a href="#main" className="sr-only-focusable absolute left-2 top-2 z-50 rounded border border-ink bg-white px-3 py-1.5 text-sm">Skip to content</a>
      <aside className={`hidden md:flex md:flex-col w-60 shrink-0 border-r p-4 ${dark ? "border-navydark bg-navy" : "border-line bg-white"}`}>
        <Link href="/" className={`flex items-center gap-2 px-2 pt-1 text-base font-semibold ${dark ? "text-white" : "text-ink"}`}>
          <BrandMark size={26} onDark={dark} /> PostAtlas
        </Link>
        <div className="mb-6 mt-3 px-2">
          <div className={`text-xs font-semibold uppercase tracking-wide ${dark ? "text-white" : "text-accenttext"}`}>{workspace}</div>
          {orgName && orgName !== workspace && <div className={`mt-0.5 truncate text-xs ${muted}`}>{orgName}</div>}
        </div>
        <NavLinks items={nav} dark={dark} label={`${area} navigation`} />
        {extra && extra.length > 0 && (
          <div className={`mt-5 border-t pt-4 ${dark ? "border-white/15" : "border-line"}`}>
            <NavLinks items={extra} dark={dark} label="More" />
          </div>
        )}
        <form action={signOut} className="mt-auto pt-8">
          <button className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${dark ? "text-[#CBD5E1] hover:bg-white/10 hover:text-white" : "text-inksoft hover:bg-mist hover:text-ink"}`}>Log out</button>
        </form>
      </aside>

      <div className="sticky top-0 z-40 border-b border-line bg-white md:hidden">
        <div className="relative flex items-center justify-between px-4 py-2.5">
          <Link href="/" className="flex items-center gap-2 text-base font-semibold"><BrandMark size={22} /> PostAtlas</Link>
          <span className="sr-only">{workspace}</span>
          <MobileAppMenu area={area} nav={nav} extra={extra}>
            <form action={signOut}><button className="w-full rounded-md px-3 py-2 text-left text-sm text-inksoft hover:bg-mist hover:text-ink">Log out</button></form>
          </MobileAppMenu>
        </div>
      </div>

      <main id="main" className="w-full min-w-0 max-w-[1180px] flex-1 p-4 sm:p-6 md:p-8">{children}</main>
    </div>
  );
}
