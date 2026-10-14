import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";

export function SiteFooter() {
  return (
    <footer className="border-t border-ink bg-ink text-paperdim mt-16 pt-12 pb-7">
      <div className="max-w-[1180px] mx-auto px-6">
        <div className="grid md:grid-cols-4 gap-8 mb-8">
          <div>
            <div className="flex items-center gap-2 font-serif font-bold text-xl text-white mb-2"><BrandMark size={28} onDark /> PostAtlas</div>
            <p className="text-sm max-w-[32ch]">Find the pages that need links, match them with relevant publishers, and keep every placement verified.</p>
          </div>
          <div>
            <h4 className="text-white text-sm mb-3">Platform</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/check">Check your website</Link></li>
              <li><Link href="/publishers">Publishers</Link></li>
              <li><Link href="/pricing">Pricing</Link></li>
              <li><Link href="/how-it-works">How It Works</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white text-sm mb-3">Resources</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/write-for-us">Write for Us</Link></li>
              <li><Link href="/blog">Resources</Link></li>
              <li><Link href="/about">About</Link></li>
              <li><Link href="/contact">Contact</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white text-sm mb-3">Legal</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/privacy">Privacy Policy</Link></li>
              <li><Link href="/terms">Terms of Service</Link></li>
              <li><Link href="/refund-policy">Refund Policy</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/15 pt-5 flex flex-wrap justify-between gap-2 text-sm text-[#9AA6B2]">
          <span>&copy; {new Date().getFullYear()} PostAtlas. All rights reserved.</span>
          <span>Backlink data is verified where indicated; unverified metrics are labeled accordingly.</span>
        </div>
      </div>
    </footer>
  );
}
