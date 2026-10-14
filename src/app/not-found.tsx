import Link from "next/link";

export const metadata = { title: "Page not found", robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="font-mono text-verdigrisdark mb-2">404</p>
        <h1 className="font-serif font-bold text-3xl mb-3">We could not find that page</h1>
        <p className="text-inksoft mb-6">It may have moved, or the link may be incomplete.</p>
        <div className="flex gap-3 justify-center flex-wrap"><Link href="/" className="btn-primary">Go to the homepage</Link><Link href="/check" className="btn">Check your website</Link></div>
      </div>
    </div>
  );
}
