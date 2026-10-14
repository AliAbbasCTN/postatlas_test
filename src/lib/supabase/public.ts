import { createClient } from "@supabase/supabase-js";

// Cookie-free anonymous client for PUBLIC pages (marketplace, sitemap). Because it never reads
// cookies, pages using it can be statically rendered / cached. It can only see what the anon role
// may see: approved listings, published blog articles, and column-limited metrics.
export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase environment variables are not configured.");
  // An unreachable database must fail fast into the page's error state instead of hanging a public page for tens of seconds.
  const timedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timedFetch } });
}
