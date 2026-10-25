import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";

export function SiteFooter() {
  return (
    <footer className="border-t border-navydark bg-navy text-[#E2E8F0] mt-16 pt-12 pb-7">
      <div className="max-w-[1180px] mx-auto px-6">
        <div className="grid md:grid-cols-4 gap-8 mb-8">
          <div>
            <div className="flex items-center gap-2 text-lg font-semibold text-white mb-2"><BrandMark size={28} onDark /> PostAtlas</div>
            <p className="text-sm max-w-[32ch]">Find the pages that need links, match them with relevant publishers, and keep every placement verified.</p>
          </div>
          <div>
            <h4 className="text-white text-sm mb-3">Platform</h4>
            <ul className="space-y-2 text-sm">
              <li><Link className="hover:text-white hover:underline" href="/check">Check your website</Link></li>
              <li><Link className="hover:text-white hover:underline" href="/publishers">Explore Sites</Link></li>
              <li><Link className="hover:text-white hover:underline" href="/buy-guest-posts">Buy Guest Posts</Link></li>
              <li><Link className="hover:text-white hover:underline" href="/link-insertion-service">Link Insertions</Link></li>
              <li><Link className="hover:text-white hover:underline" href="/backlink-monitoring">Backlink Monitoring</Link></li>
              <li><Link className="hover:text-white hover:underline" href="/for-publishers">For Publishers</Link></li>
              <li><Link className="hover:text-white hover:underline" href="/pricing">Pricing</Link></li>
              <li><Link className="hover:text-white hover:underline" href="/how-it-works">How It Works</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white text-sm mb-3">Resources</h4>
            <ul className="space-y-2 text-sm">
              <li><Link className="hover:text-white hover:underline" href="/write-for-us">Write for Us</Link></li>
              <li><Link className="hover:text-white hover:underline" href="/blog">Resources</Link></li>
              <li><Link className="hover:text-white hover:underline" href="/about">About</Link></li>
              <li><Link className="hover:text-white hover:underline" href="/contact">Contact</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white text-sm mb-3">Legal</h4>
            <ul className="space-y-2 text-sm">
              <li><Link className="hover:text-white hover:underline" href="/privacy">Privacy Policy</Link></li>
              <li><Link className="hover:text-white hover:underline" href="/terms">Terms of Service</Link></li>
              <li><Link className="hover:text-white hover:underline" href="/refund-policy">Refund Policy</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/15 pt-5 flex flex-wrap justify-between gap-2 text-sm text-[#AEB9C6]">
          <span>&copy; {new Date().getFullYear()} PostAtlas. All rights reserved.</span>
          <span>Backlink data is verified where indicated; unverified metrics are labeled accordingly.</span>
        </div>
      </div>
    </footer>
  );
}
