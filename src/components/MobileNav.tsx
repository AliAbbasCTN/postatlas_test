"use client";

import { useState } from "react";
import Link from "next/link";
import { HeaderAuth } from "@/components/HeaderAuth";

export function MobileNav({ links }: { links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button aria-label="Toggle menu" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((v) => !v)} className="px-3 py-2 border border-line rounded text-sm">
        {open ? "Close" : "Menu"}
      </button>
      {open && (
        <div id="mobile-menu" className="absolute top-full left-0 right-0 bg-paper border-b border-line px-6 py-5 flex flex-col gap-4 z-50">
          <nav aria-label="Mobile" className="flex flex-col gap-4">
            {links.map((l) => <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="text-sm text-inksoft">{l.label}</Link>)}
          </nav>
          <div className="border-t border-line pt-4 flex flex-col gap-3"><HeaderAuth mobile onNavigate={() => setOpen(false)} /></div>
        </div>
      )}
    </div>
  );
}
