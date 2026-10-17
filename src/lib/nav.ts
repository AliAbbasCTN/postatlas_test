// Pure navigation helpers (no React / Next imports) so they can be unit-tested.

// A link is active on an exact match, or when the path is below it - except for section roots such as
// /dashboard, /admin and /publisher, which would otherwise be "active" on every sub-page of that area.
export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (pathname === href) return true;
  if (href === "/dashboard" || href === "/admin" || href === "/publisher") return false;
  return pathname.startsWith(`${href}/`);
}
