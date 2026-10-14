import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/url-safety";
import { acceptPendingInvitations } from "@/lib/services/invitations";

// Exchanges the code from Supabase email links (confirmation, password reset)
// for a session. A failed exchange never continues to a protected page.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"));

  if (!code) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("That link is not valid.")}`);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("That link is invalid or has expired. Please try again.")}`);
  }
  await acceptPendingInvitations(data.user.id, data.user.email, !!data.user.email_confirmed_at);
  return NextResponse.redirect(`${origin}${next}`);
}
