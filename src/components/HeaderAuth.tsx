"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// Public pages stay cookie-free so they can be cached and crawled quickly. This small client piece
// only swaps "Log in" for "Dashboard" after load. It is a convenience, never an access check.
export function HeaderAuth({ onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let alive = true;
    createClient().auth.getUser().then(({ data }) => { if (alive) setSignedIn(!!data.user); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const link = "text-sm px-3 py-2 text-inksoft hover:text-ink transition text-center";
  const solid = "text-sm px-4 py-2.5 bg-ink text-paper rounded hover:bg-verdigrisdark transition text-center font-medium";
  return signedIn ? (
    <Link href="/dashboard" onClick={onNavigate} className={solid}>My dashboard</Link>
  ) : (
    <>
      <Link href="/login" onClick={onNavigate} className={link}>Log in</Link>
      <Link href="/check" onClick={onNavigate} className={solid}>Check your website</Link>
    </>
  );
}
