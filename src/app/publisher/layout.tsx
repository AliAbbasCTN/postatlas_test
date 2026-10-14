import { requirePublisher } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export const metadata = { robots: { index: false, follow: false } };

export default async function PublisherLayout({ children }: { children: React.ReactNode }) {
  await requirePublisher();
  return (
    <AppShell area="Publisher" nav={[{ href: "/publisher", label: "Overview" }, { href: "/publisher/orders", label: "Orders" }, { href: "/publisher/listings", label: "My websites" }, { href: "/publisher/payouts", label: "Payouts" }]} extra={[{ href: "/dashboard", label: "Customer area" }]}>
      {children}
    </AppShell>
  );
}
