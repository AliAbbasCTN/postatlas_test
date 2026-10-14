import { requireAdmin } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export const metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireAdmin();
  const nav = [
    { href: "/admin", label: "Overview" },
    { href: "/admin/orders", label: "Orders" },
    { href: "/admin/payments", label: "Payments" },
    { href: "/admin/publishers", label: "Publishers" },
    { href: "/admin/disputes", label: "Disputes" },
    { href: "/admin/recovery", label: "Recovery cases" },
    { href: "/admin/payouts", label: "Publisher payouts" },
    { href: "/admin/refunds", label: "Refunds" },
    { href: "/admin/finance", label: "Finance settings" },
    { href: "/admin/advice", label: "Advice requests" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/audit-log", label: "Audit log" },
    ...(s.platformRole === "super_admin" ? [{ href: "/admin/articles", label: "Blog" }, { href: "/admin/settings", label: "Payment settings" }] : [])
  ];
  return <AppShell dark area="Admin" orgName={s.platformRole === "super_admin" ? "Super admin" : "Admin"} nav={nav} extra={[{ href: "/dashboard", label: "Customer area" }]}>{children}</AppShell>;
}
