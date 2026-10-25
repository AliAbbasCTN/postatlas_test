"use client";

import { useState } from "react";
import Link from "next/link";
import { HeaderAuth } from "@/components/HeaderAuth";

export function MobileNav({ links }: { links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button aria-label="Toggle menu" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((v) => !v)} className="btn !py-1.5">
        {open ? "Close" : "Menu"}
      </button>
      {open && (
        <div id="mobile-menu" className="absolute left-0 right-0 top-full z-50 flex max-h-[calc(100vh-4rem)] flex-col gap-3 overflow-y-auto border-b border-line bg-white px-4 py-4 shadow-pop sm:px-6">
          <nav aria-label="Mobile" className="flex flex-col gap-1">
            {links.map((l) => <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm text-inksoft hover:bg-mist hover:text-ink">{l.label}</Link>)}
          </nav>
          <div className="border-t border-line pt-4 flex flex-col gap-3"><HeaderAuth mobile onNavigate={() => setOpen(false)} /></div>
        </div>
      )}
    </div>
  );
}
