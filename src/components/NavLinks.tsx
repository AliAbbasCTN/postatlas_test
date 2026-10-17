"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath } from "@/lib/nav";

export type NavItem = { href: string; label: string };

export function NavLinks({ items, dark = false, onNavigate, label }: { items: NavItem[]; dark?: boolean; onNavigate?: () => void; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex flex-col gap-0.5 text-sm">
      {items.map((n) => {
        const active = isActivePath(pathname, n.href);
        const base = "block px-3 py-2 rounded-md transition-colors";
        const tone = dark
          ? active ? "bg-white/15 text-white font-medium" : "text-[#CBD5E1] hover:bg-white/10 hover:text-white"
          : active ? "bg-accentsoft text-ink font-medium" : "text-inksoft hover:bg-mist hover:text-ink";
        return (
          <Link key={n.href} href={n.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`${base} ${tone}`}>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
