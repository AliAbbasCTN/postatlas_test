import { requirePublisher } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export const metadata = { robots: { index: false, follow: false } };

export default async function PublisherLayout({ children }: { children: React.ReactNode }) {
  await requirePublisher();
  return (
    <AppShell area="Publisher" nav={[{ href: "/publisher", label: "Overview" }, { href: "/publisher/orders", label: "Manage Orders" }, { href: "/publisher/listings", label: "Manage Listings" }, { href: "/publisher/payouts", label: "Track Payouts" }]} extra={[{ href: "/dashboard", label: "Switch to Customer Dashboard" }]}>
      {children}
    </AppShell>
  );
}
