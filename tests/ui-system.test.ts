import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { isActivePath } from "../src/lib/nav.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ---- colour tokens, read from the real Tailwind config so the test cannot drift from the design ----
const cfg = read("tailwind.config.ts");
const token = (name: string): string => {
  const m = cfg.match(new RegExp(`\\b${name}:\\s*"(#[0-9A-Fa-f]{6})"`));
  assert.ok(m, `tailwind token ${name} missing`);
  return m![1];
};
function lum(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test("the specified brand palette is present", () => {
  assert.equal(token("navy").toUpperCase(), "#2D3E50");
  assert.equal(token("accent").toUpperCase(), "#FF7A59");
  assert.equal(token("paperdim").toUpperCase(), "#F5F8FA");
  assert.equal(token("ink").toUpperCase(), "#1F2937");
  assert.equal(token("line").toUpperCase(), "#E2E8F0");
});

test("text colours meet WCAG AA (4.5:1) on the surfaces they are used on", () => {
  const cases: [string, string, string][] = [
    ["ink on white", token("ink"), token("paper")],
    ["ink on accent buttons", token("ink"), token("accent")],
    ["ink on accent hover", token("ink"), token("accentdark")],
    ["secondary text on white", token("inksoft"), token("paper")],
    ["secondary text on soft background", token("inksoft"), token("paperdim")],
    ["secondary text on chips/skeleton tone", token("inksoft"), token("mist")],
    ["accent text on white", token("accenttext"), token("paper")],
    ["accent text on soft background", token("accenttext"), token("paperdim")],
    ["accent text on accent tint", token("accenttext"), token("accentsoft")],
    ["white on navy", token("paper"), token("navy")],
    ["success text on success chip", token("verdigrisdark"), "#E4F3EA"],
    ["danger text on danger chip", token("redsig"), "#FBE4E1"]
  ];
  for (const [name, fg, bg] of cases) assert.ok(contrast(fg, bg) >= 4.5, `${name}: ${contrast(fg, bg).toFixed(2)}:1`);
});

test("form-field borders and the focus ring meet the 3:1 non-text contrast requirement", () => {
  assert.ok(contrast(token("inputborder"), token("paper")) >= 3, "input border");
  assert.ok(contrast(token("navy"), token("paper")) >= 3, "focus ring");
});

test("white text is never placed on the coral accent (it would be ~2.6:1)", () => {
  assert.ok(contrast(token("paper"), token("accent")) < 4.5, "premise changed - revisit button text colour");
  const css = read("src/app/globals.css");
  const primary = css.match(/\.btn-primary \{[^}]*\}/)![0];
  assert.match(primary, /bg-accent/);
  assert.match(primary, /text-ink/);
  assert.ok(!/text-(white|paper)/.test(primary));
});

// ---- navigation ----
test("active-link logic: exact and nested matches, but section roots are not active on every sub-page", () => {
  assert.equal(isActivePath("/dashboard", "/dashboard"), true);
  assert.equal(isActivePath("/dashboard/websites", "/dashboard"), false);
  assert.equal(isActivePath("/dashboard/websites", "/dashboard/websites"), true);
  assert.equal(isActivePath("/dashboard/websites/abc", "/dashboard/websites"), true);
  assert.equal(isActivePath("/dashboard/websites-old", "/dashboard/websites"), false);
  assert.equal(isActivePath("/admin/orders/9", "/admin"), false);
  assert.equal(isActivePath(null, "/dashboard"), false);
});

function pageExists(href: string): boolean {
  const clean = href.split("#")[0].split("?")[0];
  if (clean === "/") return true;
  // Walk src/app, ignoring route-group folders like (marketing); dynamic segments are matched loosely.
  const segs = clean.split("/").filter(Boolean);
  const walk = (dir: URL, i: number): boolean => {
    if (i === segs.length) return ["page.tsx", "route.ts"].some((f) => existsSync(new URL(f, dir)));
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const sub = new URL(`${e.name}/`, dir);
      if (/^\(.+\)$/.test(e.name)) { if (walk(sub, i)) return true; continue; }
      if (e.name === segs[i] || /^\[.+\]$/.test(e.name)) { if (walk(sub, i + 1)) return true; }
    }
    return false;
  };
  return walk(new URL("../src/app/", import.meta.url), 0);
}

test("every navigation link resolves to a real page (no dead links)", () => {
  const files = ["src/components/SiteHeader.tsx", "src/components/SiteFooter.tsx", "src/app/dashboard/layout.tsx", "src/app/admin/layout.tsx", "src/app/publisher/layout.tsx"];
  let checked = 0;
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/href[:=]\s*"?\{?"(\/[^"]*)"/g)) {
      if (m[1].includes("${")) continue;
      assert.ok(pageExists(m[1]), `${f} links to ${m[1]} but no such page exists`);
      checked++;
    }
  }
  assert.ok(checked >= 30, `only ${checked} links checked - the regex may have stopped matching`);
});

test("every workspace layout still enforces its server-side guard", () => {
  assert.match(read("src/app/dashboard/layout.tsx"), /await requireSession\(\)/);
  assert.match(read("src/app/admin/layout.tsx"), /await requireAdmin\(\)/);
  assert.match(read("src/app/publisher/layout.tsx"), /await requirePublisher\(\)/);
  for (const f of ["dashboard", "admin", "publisher"]) assert.match(read(`src/app/${f}/layout.tsx`), /robots: \{ index: false, follow: false \}/, `${f} must not be indexable`);
});

test("workspaces are identified and the shell is accessible", () => {
  const shell = read("src/components/AppShell.tsx");
  assert.match(shell, /Customer workspace/);
  assert.match(shell, /Publisher workspace/);
  assert.match(shell, /Skip to content/);
  assert.match(shell, /aria-label=\{`\$\{area\} navigation`\}|label=\{`\$\{area\} navigation`\}/);
  assert.match(read("src/components/NavLinks.tsx"), /aria-current=\{active \? "page" : undefined\}/);
  const menu = read("src/components/MobileAppMenu.tsx");
  assert.match(menu, /aria-expanded=\{open\}/);
  assert.match(menu, /aria-controls="app-mobile-menu"/);
  assert.match(menu, /e\.key === "Escape"/);
});

test("reduced-motion is honoured and focus is always visible", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible \{[^}]*outline: 2px/);
});

test("the public navigation matches the product (no invented sections) and the homepage CTAs work", () => {
  const header = read("src/components/SiteHeader.tsx");
  for (const l of ["Explore Sites", "Check Your Website", "For Publishers", "How It Works", "Pricing"]) assert.ok(header.includes(l), l);
  const home = read("src/app/(marketing)/page.tsx");
  assert.match(home, /Find the Right Websites\. Build Better Backlinks\./);
  assert.match(home, /href="\/publishers"[^>]*>Explore Sites/);
  assert.match(home, /href="\/for-publishers"[^>]*>Become a Publisher/);
  // Honesty: the page must not contain invented social proof or numbers.
  assert.ok(!/testimonial|\b\d{2,}\+? (customers|clients|links|publishers)\b|★|rated|% (success|increase)/i.test(home));
});

test("no secret-bearing code was moved into client components by the redesign", () => {
  for (const f of ["src/components/NavLinks.tsx", "src/components/MobileAppMenu.tsx", "src/components/MobileNav.tsx", "src/components/HeaderAuth.tsx"]) {
    const s = read(f);
    assert.ok(!/service_role|SUPABASE_SERVICE|createAdminClient|server-only/i.test(s), f);
  }
});

test("'publisher' means an approved account that lists websites and gets orders - never the blog's Write for Us page", () => {
  const home = read("src/app/(marketing)/page.tsx");
  const header = read("src/components/SiteHeader.tsx");
  const footer = read("src/components/SiteFooter.tsx");
  assert.ok(!/write-for-us[^\n]*(Publisher|publisher)|(Publisher|publisher)[^\n]*write-for-us/.test(home + header + footer.replace(/Write for Us/g, "")), "publisher CTAs must not point at /write-for-us");
  assert.match(header, /href: "\/for-publishers", label: "For Publishers"/);
  assert.match(footer, /href="\/write-for-us">Write for Us</);
  assert.match(footer, /href="\/for-publishers">For Publishers</);
  const page = read("src/app/(marketing)/for-publishers/page.tsx");
  assert.match(page, /\/apply-publisher/);
  assert.match(page, /COMMISSION_BPS/, "commission must come from the real pricing source, not a typed number");
  assert.ok(!/\b\d+% commission/.test(page), "do not hardcode a commission percentage");
  assert.match(read("src/app/sitemap.ts"), /\/for-publishers/);
});

test("publisher overview explains setup progress and listing status in plain language", () => {
  const s = read("src/app/publisher/page.tsx");
  assert.match(s, /Getting started/);
  for (const k of ["pending_review", "approved", "rejected", "suspended"]) assert.ok(s.includes(k), k);
  assert.match(read("src/app/publisher/layout.tsx"), /await requirePublisher\(\)/);
});
