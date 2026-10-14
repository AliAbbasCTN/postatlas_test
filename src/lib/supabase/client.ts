"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser client: public anon key only. Browser roles are read-only and
// RLS-filtered, so this key can never write or read another organisation's rows.
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
