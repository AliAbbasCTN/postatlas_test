import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase session cookie and keeps unauthenticated visitors out of private areas.
// This is only the first, cheap gate. Every page, layout and server action checks the session,
// role and record ownership again on the server (lib/auth.ts), and Postgres RLS is the last line.
// If Supabase cannot be reached the request is treated as signed out, never as signed in.
const PRIVATE = ["/dashboard", "/admin", "/publisher", "/apply-publisher"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  const isPrivate = PRIVATE.some((p) => path === p || path.startsWith(`${p}/`));

  let user = null;
  try {
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    });
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }

  if (isPrivate && !user) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/publisher/:path*", "/apply-publisher/:path*"]
};
