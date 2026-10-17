"use client";

import Link from "next/link";

// Contains a failure inside the dashboard so the sidebar stays usable. Shows only the support reference (digest),
// never the underlying error text.
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="max-w-xl rounded-lg border border-line bg-white p-6 shadow-card">
      <h1 className="mb-2 text-xl font-semibold">We could not load this page</h1>
      <p className="mb-5 text-sm text-inksoft">Nothing you did caused this. Please try again, or go back to your overview.{error.digest ? ` (Reference: ${error.digest})` : ""}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="btn-primary">Try again</button>
        <Link href="/dashboard" className="btn">Back to overview</Link>
      </div>
    </div>
  );
}
