import { requireSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { workspaceLabel } from "@/lib/workspace";

export const metadata = { robots: { index: false, follow: false } };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const extra = [
    { href: "/dashboard/advice", label: "Ask for advice" },
    ...(session.platformRole === "publisher" ? [{ href: "/publisher", label: "Publisher area" }] : session.platformRole === "user" ? [{ href: "/apply-publisher", label: "Become a publisher" }] : []),
    ...(session.platformRole === "admin" || session.platformRole === "super_admin" ? [{ href: "/admin", label: "Admin" }] : [])
  ];
  return (
    <AppShell
      area="Account"
      orgName={session.org ? workspaceLabel(session.org) : "Your account"}
      nav={[
        { href: "/dashboard", label: "Home" },
        { href: "/dashboard/websites", label: "Websites" },
        { href: "/dashboard/opportunities", label: "Opportunities" },
        { href: "/dashboard/publishers", label: "Publishers" },
        { href: "/dashboard/orders", label: "Orders" },
        { href: "/dashboard/placements", label: "Placements" },
        { href: "/dashboard/monitoring", label: "Monitoring" },
        { href: "/dashboard/settings", label: "Settings" }
      ]}
      extra={extra}
    >
      {children}
    </AppShell>
  );
}
