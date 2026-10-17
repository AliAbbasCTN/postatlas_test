"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NavLinks, type NavItem } from "@/components/NavLinks";

// Mobile navigation for the signed-in areas: a button that opens a full list of links. Closes on navigation,
// on Escape (returning focus to the button) and on the "Close" button. The sign-out form is rendered by the
// server component and passed in as children, so no server action is imported here.
export function MobileAppMenu({ area, nav, extra, children }: { area: string; nav: NavItem[]; extra?: NavItem[]; children?: React.ReactNode }) {
  // The menu is "open for" the page it was opened on, so navigating to another page closes it without an effect.
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpenPath(null); button.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button ref={button} type="button" aria-expanded={open} aria-controls="app-mobile-menu" onClick={() => setOpenPath(open ? null : pathname)} className="btn !py-1.5">
        {open ? "Close" : "Menu"}
      </button>
      {open && (
        <div id="app-mobile-menu" className="absolute left-0 right-0 top-full z-40 max-h-[calc(100vh-4rem)] overflow-y-auto border-b border-line bg-white px-4 py-4 shadow-pop">
          <NavLinks items={nav} label={`${area} navigation`} />
          {extra && extra.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <NavLinks items={extra} label="More" />
            </div>
          )}
          {children && <div className="mt-3 border-t border-line pt-3">{children}</div>}
        </div>
      )}
    </div>
  );
}
