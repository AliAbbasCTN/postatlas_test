import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client. This BYPASSES Row Level Security entirely.
// - Only import it from server-only modules (the "server-only" import throws a
//   build error if it ever ends up in a client bundle).
// - Use it only AFTER the caller has been authenticated, authorised for the
//   specific record, and the input validated. It is the write path for the
//   whole app: browser roles have SELECT-only access (see supabase/PostAtlas_fresh_supabase_schema.sql).
// - The key is never prefixed NEXT_PUBLIC_, so it cannot reach the browser.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL are not configured.");
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
