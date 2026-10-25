import { requireSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { workspaceLabel } from "@/lib/workspace";

export const metadata = { robots: { index: false, follow: false } };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const extra = [
    { href: "/dashboard/advice", label: "Get Advice" },
    ...(session.platformRole === "publisher" ? [{ href: "/publisher", label: "Switch to Publisher Dashboard" }] : session.platformRole === "user" ? [{ href: "/apply-publisher", label: "Become a Publisher" }] : []),
    ...(session.platformRole === "admin" || session.platformRole === "super_admin" ? [{ href: "/admin", label: "Switch to Admin Dashboard" }] : [])
  ];
  return (
    <AppShell
      area="Account"
      orgName={session.org ? workspaceLabel(session.org) : "Your account"}
      nav={[
        { href: "/dashboard", label: "Overview" },
        { href: "/dashboard/websites", label: "My Websites" },
        { href: "/dashboard/opportunities", label: "Find Link Opportunities" },
        { href: "/dashboard/publishers", label: "Find Publishers" },
        { href: "/dashboard/orders", label: "Manage Orders" },
        { href: "/dashboard/placements", label: "Track Placements" },
        { href: "/dashboard/monitoring", label: "Monitor Backlinks" },
        { href: "/dashboard/settings", label: "Account Settings" }
      ]}
      extra={extra}
    >
      {children}
    </AppShell>
  );
}
